import { Prisma } from "@prisma/client";
import prisma from "../../db.server";
import redisClient from "../../redis.server";
import { decryptGiftCard } from "../utils/encryption.server";
import { canDeactivateGiftCards, canUseUsageTracking } from "../subscriptions/plans";
import {
  createShopAdminGraphqlClient,
  trackGiftCardUsage,
} from "./gift-card-tracker.server";
import { processAllUsageRefreshes } from "./usage-refresh-processor.server";
import {
  enqueueUsageRefresh,
  getUsageRefreshProgress,
} from "./usage-refresh-queue.server";
import { triggerWorkerJob } from "./worker-trigger.server";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { GiftCard, GiftCardUsageRecord, UsageMetrics } from "../types";

const INLINE_USAGE_THRESHOLD = 500;
const USAGE_REFRESH_COOLDOWN_MS = 60 * 60 * 1000;
// How long after a cancel we still treat the worker as potentially mid-loop.
// The Shopify HTTP client timeout is 30s and a single network-error retry can
// stretch one iteration to ~60s. The worker only observes the cancel between
// iterations, so until it finalises (and writes a terminal status to Redis)
// it may still be making API calls. Resuming or deactivating during that
// window races against the worker. After the grace window we assume the
// worker is dead/stuck rather than block forever.
const CANCEL_GRACE_MS = 60_000;
// Redis statuses indicating the worker has exited the create loop and is no
// longer making Shopify calls for this job. Anything else (empty key, or
// "running") means the worker may still be alive.
const WORKER_EXITED_REDIS_STATUSES = new Set(["cancelled", "failed", "completed"]);

interface JobDetailsPageInput {
  jobId: string;
  shopName: string;
}

interface JobDetailActionInput extends JobDetailsPageInput {
  admin: AdminApiContext;
  currentPlanId: number;
  intent: FormDataEntryValue | null;
}

interface JobActionResult {
  body: unknown;
  status?: number;
}

const CANCEL_FINALISING_RESPONSE: JobActionResult = {
  body: { message: "Cancellation is still finalising. Please try again in a moment." },
  status: 409,
};

// Returns true if the source job was cancelled recently and the create worker
// may still be making Shopify calls (i.e. has not yet written a terminal
// status to Redis). Both resume and deactivate must refuse during this window:
// resume to avoid two workers operating on the same job, deactivate to avoid
// reading the gift_cards column before the worker finalises in-memory cards
// added since the last checkpoint.
async function isCancelGraceActive(
  jobId: string,
  shopName: string,
): Promise<boolean> {
  const cancelledJob = await prisma.job.findFirst({
    where: { id: jobId, shopName, status: "cancelled", jobType: "create" },
    select: { finishedAt: true },
  });
  if (!cancelledJob?.finishedAt) return false;

  const sinceCancelMs = Date.now() - cancelledJob.finishedAt.getTime();
  if (sinceCancelMs >= CANCEL_GRACE_MS) return false;

  try {
    const redisStatus = await redisClient.hget(`job_status:${jobId}`, "status");
    if (redisStatus !== null && WORKER_EXITED_REDIS_STATUSES.has(redisStatus)) {
      return false;
    }
  } catch (error) {
    console.error("Error reading redis status for cancel grace check:", error);
    // Fall through; fail closed — the bounded refusal beats a race.
  }
  return true;
}

function getUsageRefreshRemainingMs(
  usageLastRefreshedAt: Date | string | null | undefined,
): number {
  if (!usageLastRefreshedAt) {
    return 0;
  }

  const elapsedMs = Date.now() - new Date(usageLastRefreshedAt).getTime();
  return Math.max(0, USAGE_REFRESH_COOLDOWN_MS - elapsedMs);
}

function buildUsageMetrics(
  usageRecords: Array<{
    initialValue: unknown;
    currentBalance: unknown;
    amountRedeemed: unknown;
    balanceStatus: string;
    status: string;
  }>,
): UsageMetrics {
  const metrics: UsageMetrics = {
    totalCards: usageRecords.length,
    totalInitialValue: 0,
    totalCurrentBalance: 0,
    totalRedeemed: 0,
    redemptionRate: 0,
    fullBalance: 0,
    partialBalance: 0,
    emptyBalance: 0,
    enabled: 0,
    disabled: 0,
    expired: 0,
  };

  for (const record of usageRecords) {
    const initial = Number(record.initialValue);
    const current = Number(record.currentBalance);
    const redeemed = Number(record.amountRedeemed);

    metrics.totalInitialValue += initial;
    metrics.totalCurrentBalance += current;
    metrics.totalRedeemed += redeemed;

    switch (record.balanceStatus) {
      case "full":
        metrics.fullBalance++;
        break;
      case "partial":
        metrics.partialBalance++;
        break;
      case "empty":
        metrics.emptyBalance++;
        break;
    }

    switch (record.status) {
      case "enabled":
        metrics.enabled++;
        break;
      case "disabled":
        metrics.disabled++;
        break;
      case "expired":
        metrics.expired++;
        break;
    }
  }

  if (metrics.totalInitialValue > 0) {
    metrics.redemptionRate = (metrics.totalRedeemed / metrics.totalInitialValue) * 100;
  }

  return metrics;
}

function buildUsagePreviewRecords(
  usageRecords: Array<{
    giftCardId: string;
    lastCharacters: string;
    initialValue: unknown;
    currentBalance: unknown;
    amountRedeemed: unknown;
    status: string;
    balanceStatus: string;
  }>,
): GiftCardUsageRecord[] {
  return usageRecords.slice(0, 100).map((record) => ({
    giftCardId: record.giftCardId,
    lastCharacters: record.lastCharacters,
    initialValue: Number(record.initialValue),
    currentBalance: Number(record.currentBalance),
    amountRedeemed: Number(record.amountRedeemed),
    status: record.status,
    balanceStatus: record.balanceStatus,
  }));
}

function decryptGiftCards(giftCards: unknown): GiftCard[] {
  if (!giftCards || !Array.isArray(giftCards)) {
    return [];
  }

  return (giftCards as GiftCard[]).map((giftCard) => {
    try {
      return {
        ...giftCard,
        code: decryptGiftCard(giftCard.code),
      };
    } catch {
      return giftCard;
    }
  });
}

export async function loadJobDetailsPageData({ jobId, shopName }: JobDetailsPageInput) {
  const [job, allJobIds] = await Promise.all([
    prisma.job.findFirst({
      where: { id: jobId, shopName },
    }),
    prisma.job.findMany({
      where: { shopName, jobType: { not: "deactivate" } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }),
  ]);

  if (!job) {
    return null;
  }

  let giftCards = decryptGiftCards(job.giftCards);

  // Backfill missing gift card IDs from usage tracking records
  const hasMissingIds = giftCards.some((gc) => !gc.id);
  if (hasMissingIds) {
    const usageRecords = await prisma.giftCardUsage.findMany({
      where: { jobId },
      select: { giftCardId: true, lastCharacters: true },
    });

    if (usageRecords.length > 0) {
      const idsByLastChars = new Map<string, string[]>();
      for (const rec of usageRecords) {
        const list = idsByLastChars.get(rec.lastCharacters) ?? [];
        list.push(rec.giftCardId);
        idsByLastChars.set(rec.lastCharacters, list);
      }

      giftCards = giftCards.map((gc) => {
        if (gc.id) return gc;
        const ids = idsByLastChars.get(gc.last_characters);
        if (ids && ids.length > 0) {
          return { ...gc, id: Number(ids.shift()) };
        }
        return gc;
      });
    }
  }

  const jobIds = allJobIds.map((item) => item.id);
  const currentIndex = jobIds.indexOf(jobId);

  // Check if there's an active deactivation job for this source job.
  const activeDeactivation = await prisma.job.findFirst({
    where: {
      sourceJobId: jobId,
      jobType: "deactivate",
      status: { in: ["pending", "running"] },
    },
    select: { id: true },
  });

  return {
    job: {
      ...job,
      value: Number(job.value),
    },
    giftCards,
    totalCards: giftCards.length,
    usageRefreshRemainingMs: getUsageRefreshRemainingMs(job.usageLastRefreshedAt),
    jobIds,
    prevJobId: currentIndex > 0 ? jobIds[currentIndex - 1] : null,
    nextJobId: currentIndex < jobIds.length - 1 ? jobIds[currentIndex + 1] : null,
    shopHandle: shopName.split(".")[0] ?? "",
    activeDeactivationJobId: activeDeactivation?.id ?? null,
  };
}

// Serializes resume/deactivate critical sections on the same source job.
// Without this, two concurrent requests can interleave: deactivate reads
// status="cancelled", resume flips it to "pending", deactivate then creates
// a child against a now-pending job. The advisory lock is keyed on jobId
// and released automatically when the transaction commits or rolls back.
async function withJobLock<T>(
  jobId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${jobId}))`;
      return fn(tx);
    },
    { timeout: 15_000 },
  );
}

async function clearJobStatusCache(jobId: string, context: string) {
  try {
    await redisClient.del(`job_status:${jobId}`);
  } catch (error) {
    console.error(`Error clearing redis status for ${context}:`, error);
  }
}

async function cancelJob({
  jobId,
  shopName,
}: JobDetailsPageInput): Promise<JobActionResult> {
  try {
    const result = await prisma.job.updateMany({
      where: {
        id: jobId,
        shopName,
        status: { in: ["pending", "running", "scheduled"] },
      },
      data: { status: "cancelled", finishedAt: new Date() },
    });

    if (result.count === 0) {
      return {
        body: { message: "Job cannot be cancelled in its current state" },
        status: 409,
      };
    }

    // Drop any stale "running" Redis hash so polling reflects the cancel
    // immediately. The worker rewrites this with status="cancelled" once it
    // observes the cancellation and finalizes partials.
    await clearJobStatusCache(jobId, "cancel");

    return { body: { message: "job cancelled" } };
  } catch {
    return { body: { message: "error cancelling job" }, status: 500 };
  }
}

async function retryJob({
  jobId,
  shopName,
}: JobDetailsPageInput): Promise<JobActionResult> {
  // Atomic check-and-update: only transition from "failed" to "pending"
  const result = await prisma.job.updateMany({
    where: { id: jobId, shopName, status: "failed" },
    data: { status: "pending", errorMessage: null },
  });

  if (result.count === 0) {
    const job = await prisma.job.findFirst({
      where: { id: jobId, shopName },
    });

    if (!job) {
      return { body: { message: "job not found" }, status: 404 };
    }

    return {
      body: { message: "only failed jobs can be retried" },
      status: 400,
    };
  }

  // Drop the stale "failed" Redis hash so polling reflects pending until the
  // worker claims the job and writes a fresh entry.
  await clearJobStatusCache(jobId, "retry");

  try {
    await triggerWorkerJob(jobId, shopName);
  } catch (error) {
    console.error("Error triggering worker for retry:", error);
    // Revert to failed since the worker couldn't be reached
    await prisma.job.updateMany({
      where: { id: jobId, shopName, status: "pending" },
      data: {
        status: "failed",
        errorMessage: "Failed to reach worker service. Please try again.",
      },
    });
    return {
      body: { message: "Failed to reach worker service. Please try again." },
      status: 502,
    };
  }

  return { body: { message: "job retrying" } };
}

async function resumeJob({
  jobId,
  shopName,
}: JobDetailsPageInput): Promise<JobActionResult> {
  // Refuse while the previous worker may still be mid-Shopify-call. Done
  // before the lock so we don't hold it across the Redis round-trip.
  if (await isCancelGraceActive(jobId, shopName)) {
    return CANCEL_FINALISING_RESPONSE;
  }

  // Serialize against deactivateJob on the same source job. Holding the lock
  // across the active-deactivation check and the cancelled→pending update
  // closes the interleaving where deactivate reads cancelled, resume flips
  // to pending, and deactivate then creates a child for a pending job.
  const outcome = await withJobLock(jobId, async (tx) => {
    const activeDeactivation = await tx.job.findFirst({
      where: {
        sourceJobId: jobId,
        jobType: "deactivate",
        status: { in: ["pending", "running"] },
      },
      select: { id: true },
    });
    if (activeDeactivation) {
      return "blocked-active-deactivation" as const;
    }

    const result = await tx.job.updateMany({
      where: {
        id: jobId,
        shopName,
        status: "cancelled",
        deactivatedAt: null,
        jobType: "create",
      },
      data: { status: "pending", finishedAt: null, errorMessage: null },
    });
    return result.count === 0 ? ("not-resumable" as const) : ("resumed" as const);
  });

  if (outcome === "blocked-active-deactivation") {
    return {
      body: { message: "Cannot resume while deactivation is in progress" },
      status: 409,
    };
  }

  if (outcome === "not-resumable") {
    return {
      body: { message: "Job cannot be resumed in its current state" },
      status: 409,
    };
  }

  // Clear stale "cancelled" Redis hash so polling reflects pending until the
  // worker claims the resumed job and writes a fresh entry.
  await clearJobStatusCache(jobId, "resume");

  try {
    await triggerWorkerJob(jobId, shopName);
  } catch (error) {
    console.error("Error triggering worker for resume:", error);
    // Roll back so the user can try again. Mirrors retryJob's rollback.
    await prisma.job.updateMany({
      where: { id: jobId, shopName, status: "pending" },
      data: {
        status: "cancelled",
        errorMessage: "Failed to reach worker service. Please try again.",
      },
    });
    return {
      body: { message: "Failed to reach worker service. Please try again." },
      status: 502,
    };
  }

  return { body: { message: "job resuming" } };
}

async function getJobUsage({
  currentPlanId,
  jobId,
  shopName,
}: JobDetailsPageInput & { currentPlanId: number }): Promise<JobActionResult> {
  if (!canUseUsageTracking(currentPlanId)) {
    return {
      body: {
        message:
          "Gift card usage tracking is available for Premium and Ultimate plans only",
      },
      status: 403,
    };
  }

  const job = await prisma.job.findFirst({
    where: { id: jobId, shopName },
    select: { id: true, usageLastRefreshedAt: true },
  });

  if (!job) {
    return { body: { message: "job not found" }, status: 404 };
  }

  const usageRecords = await prisma.giftCardUsage.findMany({
    where: { jobId },
    orderBy: { createdAt: "asc" },
  });

  if (usageRecords.length === 0) {
    return {
      body: {
        metrics: null,
        records: [],
        recordCount: 0,
        lastRefreshedAt: job.usageLastRefreshedAt,
        remainingMs: getUsageRefreshRemainingMs(job.usageLastRefreshedAt),
        hasData: false,
      },
    };
  }

  return {
    body: {
      metrics: buildUsageMetrics(usageRecords),
      records: buildUsagePreviewRecords(usageRecords),
      recordCount: usageRecords.length,
      lastRefreshedAt: job.usageLastRefreshedAt,
      remainingMs: getUsageRefreshRemainingMs(job.usageLastRefreshedAt),
      hasData: true,
    },
  };
}

async function refreshJobUsage({
  admin,
  currentPlanId,
  jobId,
  shopName,
}: Omit<JobDetailActionInput, "intent">): Promise<JobActionResult> {
  if (!canUseUsageTracking(currentPlanId)) {
    return {
      body: {
        message:
          "Gift card usage tracking is available for Premium and Ultimate plans only",
      },
      status: 403,
    };
  }

  const job = await prisma.job.findFirst({
    where: { id: jobId, shopName },
    select: {
      id: true,
      count: true,
      status: true,
      usageLastRefreshedAt: true,
      giftCards: true,
    },
  });

  if (!job) {
    return { body: { message: "job not found" }, status: 404 };
  }

  if (job.status !== "completed") {
    return {
      body: { message: "Usage refresh is only available for completed jobs" },
      status: 400,
    };
  }

  const runningJobs = await prisma.job.findMany({
    where: {
      shopName,
      id: { not: jobId },
      status: {
        in: ["pending", "running"],
      },
    },
    select: {
      id: true,
      status: true,
      count: true,
    },
  });

  if (runningJobs.length > 0) {
    return {
      body: {
        message: `Cannot fetch usage tracking while gift card creation is in progress. You have ${runningJobs.length} job(s) currently running. Please try again later.`,
        runningJobs,
      },
      status: 409,
    };
  }

  const existingUsageCount = await prisma.giftCardUsage.count({
    where: { jobId },
  });

  if (
    existingUsageCount > 0 &&
    job.usageLastRefreshedAt &&
    getUsageRefreshRemainingMs(job.usageLastRefreshedAt) > 0
  ) {
    const remainingMs = getUsageRefreshRemainingMs(job.usageLastRefreshedAt);
    const remainingMinutes = Math.ceil(remainingMs / 60000);

    return {
      body: {
        message: `Please wait ${remainingMinutes} minute(s) before refreshing again`,
        remainingMs,
      },
      status: 429,
    };
  }

  const giftCards = job.giftCards as Array<{ id: number; value: number }> | null;
  if (!giftCards || giftCards.length === 0) {
    return { body: { message: "No gift cards found for this job" }, status: 400 };
  }

  if (giftCards.length <= INLINE_USAGE_THRESHOLD) {
    try {
      await trackGiftCardUsage(
        {
          graphql: admin.graphql.bind(admin),
        },
        jobId,
        giftCards,
      );
      return { body: { message: "Usage data refreshed", mode: "inline" } };
    } catch (error) {
      console.error("Error refreshing usage inline:", error);
      return {
        body: {
          message:
            error instanceof Error ? error.message : "Failed to refresh usage data",
        },
        status: 500,
      };
    }
  }

  try {
    const existingProgress = await getUsageRefreshProgress(jobId);

    if (
      existingProgress &&
      (existingProgress.status === "queued" || existingProgress.status === "processing")
    ) {
      return {
        body: {
          message: "Usage refresh is already in progress",
          mode: "background",
          progress: existingProgress,
        },
      };
    }

    await createShopAdminGraphqlClient(shopName);
    await enqueueUsageRefresh(jobId, shopName);
    void processAllUsageRefreshes().catch((error) => {
      console.error("Error processing usage refresh queue:", error);
    });
    return { body: { message: "Usage refresh queued", mode: "background" } };
  } catch (error) {
    console.error("Error enqueuing usage refresh:", error);
    return { body: { message: "Failed to queue usage refresh" }, status: 500 };
  }
}

async function deactivateJob({
  currentPlanId,
  jobId,
  shopName,
}: JobDetailsPageInput & { currentPlanId: number }): Promise<JobActionResult> {
  if (!canDeactivateGiftCards(currentPlanId)) {
    return {
      body: {
        message:
          "Gift card deactivation is available for Premium and Ultimate plans only",
      },
      status: 403,
    };
  }

  // For cancelled source jobs, refuse while the create worker may still be
  // mid-Shopify-call. The gift_cards column reflects only the last DB
  // checkpoint until the worker exits and finalises in-memory cards added
  // since; deactivating against that snapshot would skip the unsaved cards
  // and still mark deactivatedAt.
  if (await isCancelGraceActive(jobId, shopName)) {
    return CANCEL_FINALISING_RESPONSE;
  }

  // Serialize against resumeJob on the same source job. Holding the lock
  // across the read, the existing-deactivation check, and the child-job
  // create prevents a concurrent resume from flipping status to pending in
  // between, which would otherwise leave us with a pending deactivation
  // child for a now-pending source job.
  const outcome = await withJobLock(jobId, async (tx) => {
    const job = await tx.job.findFirst({
      where: {
        id: jobId,
        shopName,
        status: { in: ["completed", "cancelled"] },
      },
      select: {
        id: true,
        count: true,
        status: true,
        deactivatedAt: true,
        giftCards: true,
      },
    });
    if (!job) return { kind: "not-found" } as const;
    if (job.deactivatedAt) return { kind: "already-deactivated" } as const;
    if (
      job.status === "cancelled" &&
      (!Array.isArray(job.giftCards) || job.giftCards.length === 0)
    ) {
      return { kind: "no-cards" } as const;
    }

    const existingDeactivation = await tx.job.findFirst({
      where: {
        sourceJobId: jobId,
        jobType: "deactivate",
        status: { in: ["pending", "running"] },
      },
      select: { id: true },
    });
    if (existingDeactivation) return { kind: "already-in-progress" } as const;

    // count is 0 because no new gift cards are created — the original job's
    // count still counts toward the monthly plan limit.
    const deactivationJobId = crypto.randomUUID();
    await tx.job.create({
      data: {
        id: deactivationJobId,
        jobType: "deactivate",
        sourceJobId: jobId,
        count: 0,
        shopName,
        status: "pending",
      },
    });
    return { kind: "created", deactivationJobId } as const;
  });

  switch (outcome.kind) {
    case "not-found":
      return {
        body: { message: "Job not found or not in a deactivatable state" },
        status: 404,
      };
    case "already-deactivated":
      return {
        body: { message: "Gift cards from this job have already been deactivated" },
        status: 409,
      };
    case "no-cards":
      return {
        body: { message: "No gift cards to deactivate for this job" },
        status: 400,
      };
    case "already-in-progress":
      return {
        body: { message: "A deactivation is already in progress for this job" },
        status: 409,
      };
    case "created":
      try {
        await triggerWorkerJob(outcome.deactivationJobId, shopName);
      } catch (error) {
        console.error("Error triggering worker for deactivation:", error);
        // Don't revert — the job is pending and the scheduler will pick it up.
      }
      return { body: { message: "Gift cards will be deactivated shortly" } };
  }
}

export async function handleJobDetailAction({
  admin,
  currentPlanId,
  intent,
  jobId,
  shopName,
}: JobDetailActionInput): Promise<JobActionResult> {
  switch (intent) {
    case "cancel":
      return cancelJob({ jobId, shopName });
    case "resume":
      return resumeJob({ jobId, shopName });
    case "retry":
      return retryJob({ jobId, shopName });
    case "deactivate":
      return deactivateJob({ currentPlanId, jobId, shopName });
    case "usage":
      return getJobUsage({ currentPlanId, jobId, shopName });
    case "usage-refresh":
      return refreshJobUsage({ admin, currentPlanId, jobId, shopName });
    default:
      return { body: { message: "Unknown intent" }, status: 400 };
  }
}

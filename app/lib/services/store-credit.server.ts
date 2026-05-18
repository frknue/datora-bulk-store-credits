import { DateTime } from "luxon";
import prisma from "../../db.server";
import redisClient from "../../redis.server";
import {
  canRunJobsWithPlan,
  getFeatureMinimumPlan,
  getPlanFromBilling,
  hasPlanFeature,
} from "../../services/plan.server";
import {
  STORE_CREDIT_RULES,
  validateCreateStoreCreditJobInput,
  type CreateStoreCreditJobBody,
  type StoreCreditCurrency,
} from "../../../shared/store-credit";
import { triggerStoreCreditJob } from "./worker-trigger.server";
import type { authenticate } from "../../shopify.server";

import { resolveSegmentMemberIds } from "./segments.server";

type AdminAuthContext = Awaited<ReturnType<typeof authenticate.admin>>;
type BillingContext = AdminAuthContext["billing"];
type SessionContext = AdminAuthContext["session"];
type AdminGraphqlClient = AdminAuthContext["admin"];

interface CreateStoreCreditJobResult {
  body: {
    message: string;
    jobId?: string;
    status?: string;
  };
  status: number;
}

interface ScheduledTimestampResult {
  scheduledTimestamp?: string;
  error?: string;
}

function buildErrorResult(
  message: string,
  status = 400,
): CreateStoreCreditJobResult {
  return { body: { message }, status };
}

function hasAccessScope(
  scopeString: string | null | undefined,
  requiredScope: string,
): boolean {
  if (!scopeString) return false;
  return scopeString
    .split(",")
    .map((s) => s.trim())
    .includes(requiredScope);
}

function extractNumericId(gid: string): string {
  const match = gid.match(/(\d+)$/);
  return match ? match[1] : gid;
}

function isOffsetTimezone(tz: string): boolean {
  return /^[+-]\d{2}:\d{2}$/.test(tz) || tz === "00:00";
}

function resolveTimezone(tz: string): string {
  if (tz === "00:00") return "UTC";
  if (isOffsetTimezone(tz)) return `UTC${tz}`;
  return tz;
}

function parseScheduledTimestamp(
  date?: string,
  time?: string,
  timezone?: string,
): ScheduledTimestampResult {
  if (!date || !time || !timezone) return {};
  try {
    const dt = DateTime.fromISO(`${date}T${time}:00`, {
      zone: resolveTimezone(timezone),
    });
    const iso = dt.toUTC().toISO();
    if (!iso) {
      return { error: "Invalid scheduled delivery date, time, or timezone" };
    }
    const scheduled = new Date(iso);
    const now = new Date();
    if (scheduled <= now) {
      return { error: "Scheduled delivery time must be in the future" };
    }
    const ninetyDays = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    if (scheduled > ninetyDays) {
      return { error: "Scheduled delivery time must be within 90 days" };
    }
    return { scheduledTimestamp: iso };
  } catch (e) {
    console.error("Error parsing scheduled time:", e);
    return { error: "Invalid scheduled delivery date, time, or timezone" };
  }
}

export async function createStoreCreditJob(
  admin: AdminGraphqlClient,
  billing: BillingContext,
  session: SessionContext,
  body: CreateStoreCreditJobBody,
): Promise<CreateStoreCreditJobResult> {
  const validationErrors = validateCreateStoreCreditJobInput(body);
  if (validationErrors.length > 0) {
    return buildErrorResult(validationErrors[0].message);
  }

  if (!hasAccessScope(session.scope, "write_store_credit_account_transactions")) {
    return buildErrorResult(
      "Issuing store credit requires the Shopify write_store_credit_account_transactions scope. Reinstall or reauthorize the app, then try again.",
      403,
    );
  }

  if (body.expireDate) {
    const exp = new Date(`${body.expireDate}T23:59:59.999`);
    if (Number.isNaN(exp.getTime()) || exp <= new Date()) {
      return buildErrorResult("Expire date must be in the future");
    }
  }

  const hasSchedulingFields = Boolean(
    body.scheduledDate ||
      body.scheduledTime ||
      body.scheduledTimezone ||
      body.scheduledMessage,
  );

  if (
    hasSchedulingFields &&
    (!body.scheduledDate || !body.scheduledTime || !body.scheduledTimezone)
  ) {
    return buildErrorResult(
      "Scheduled date, time, and timezone are all required",
    );
  }

  const { scheduledTimestamp, error: scheduleError } = parseScheduledTimestamp(
    body.scheduledDate,
    body.scheduledTime,
    body.scheduledTimezone,
  );

  if (scheduleError) return buildErrorResult(scheduleError);

  const plan = await getPlanFromBilling(admin, billing, session.shop);

  if (!hasPlanFeature(plan, "send-by-email")) {
    return buildErrorResult(
      `Store credit issuance requires the ${getFeatureMinimumPlan("send-by-email")} plan or higher`,
      403,
    );
  }

  const activeJobCount = await prisma.storeCreditJob.count({
    where: {
      shopName: session.shop,
      status: { in: ["pending", "running"] },
    },
  });

  if (!canRunJobsWithPlan(plan, activeJobCount)) {
    return buildErrorResult(
      `Your ${plan.name} plan allows ${plan.jobs} running job(s) at once. Please wait for an active job to finish.`,
    );
  }

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  // Store credit has its own monthly usage — independent of the gift-card
  // counter. Each feature has its own allowance (plan.maxGiftCards vs
  // plan.maxStoreCredits).
  const storeCreditMonthly = await prisma.storeCreditJob.aggregate({
    where: {
      shopName: session.shop,
      createdAt: { gte: startOfMonth },
      status: {
        in: [
          "scheduled",
          "pending",
          "running",
          "completed",
          "completed_with_errors",
        ],
      },
    },
    _sum: { count: true },
  });

  const monthlyUsed = storeCreditMonthly._sum.count || 0;

  const rawIds = Array.isArray(body.customerIds)
    ? body.customerIds
    : (body.customerIds || "").split(",");
  const segmentIdInputs = Array.isArray(body.segmentIds)
    ? body.segmentIds.filter(Boolean)
    : [];

  const segmentMemberIds: string[] = [];
  for (const segmentId of segmentIdInputs) {
    try {
      const ids = await resolveSegmentMemberIds(admin, segmentId);
      segmentMemberIds.push(...ids);
    } catch (e) {
      console.error("Error resolving segment members:", segmentId, e);
      return buildErrorResult(
        "Failed to resolve segment members. Please try again.",
      );
    }
  }

  const seen = new Set<string>();
  const numericIds: string[] = [];
  for (const raw of [...rawIds, ...segmentMemberIds]) {
    const id = extractNumericId(String(raw).trim());
    if (!id || seen.has(id)) continue;
    seen.add(id);
    numericIds.push(id);
  }

  if (numericIds.length === 0) {
    return buildErrorResult("At least one valid customer ID is required");
  }

  if (numericIds.length > STORE_CREDIT_RULES.maxRecipientsPerJob) {
    return buildErrorResult(
      `No more than ${STORE_CREDIT_RULES.maxRecipientsPerJob} recipients per job`,
    );
  }

  const storeCreditLimit = plan.maxStoreCredits;
  const wouldExceedLimit =
    storeCreditLimit !== -1 &&
    monthlyUsed + numericIds.length > storeCreditLimit;
  if (wouldExceedLimit) {
    const remaining = Math.max(0, storeCreditLimit - monthlyUsed);
    return buildErrorResult(
      `Your ${plan.name} plan allows ${storeCreditLimit} store credits per month. You can issue ${remaining} more this month.`,
    );
  }

  const customerIdString = numericIds.join(",");
  const jobId = crypto.randomUUID();
  const notify = body.notify !== false;

  await prisma.storeCreditJob.create({
    data: {
      id: jobId,
      shopName: session.shop,
      userId: session.onlineAccessInfo?.associated_user?.id
        ? BigInt(session.onlineAccessInfo.associated_user.id)
        : null,
      status: scheduledTimestamp ? "scheduled" : "pending",
      amount: body.amount,
      currency: body.currency as StoreCreditCurrency,
      expiresAt: body.expireDate
        ? new Date(`${body.expireDate}T23:59:59.999Z`)
        : null,
      notify,
      note: body.note?.trim() || null,
      customerIds: customerIdString,
      count: numericIds.length,
      scheduledDate: body.scheduledDate || null,
      scheduledTime: body.scheduledTime || null,
      scheduledTimezone: body.scheduledTimezone || null,
      scheduledTimestamp: scheduledTimestamp || null,
      scheduledMessage: body.scheduledMessage || null,
    },
  });

  if (!scheduledTimestamp) {
    try {
      await triggerStoreCreditJob(jobId, session.shop);
    } catch (e) {
      console.error("Error triggering worker for store credit job:", jobId, e);
      await prisma.storeCreditJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          errorMessage: "Failed to reach worker service. Please retry the job.",
        },
      });
      return buildErrorResult(
        "Job was created but the worker service is unreachable. The job has been marked as failed — you can retry it from the job details page.",
        503,
      );
    }
  }

  return {
    body: {
      message: "Store credit job created",
      jobId,
      status: scheduledTimestamp ? "scheduled" : "pending",
    },
    status: 201,
  };
}

export interface StoreCreditJobProgress {
  jobId: string;
  done: number;
  total: number;
  status: string;
}

export async function getStoreCreditJobsProgress(
  jobIds: string[],
): Promise<StoreCreditJobProgress[]> {
  const out: StoreCreditJobProgress[] = [];
  for (const jobId of jobIds) {
    try {
      const hash = await redisClient.hgetall(`store_credit_job_status:${jobId}`);
      if (hash && Object.keys(hash).length > 0) {
        out.push({
          jobId,
          done: parseInt(hash.done || "0", 10),
          total: parseInt(hash.total || "0", 10),
          status: hash.status || "unknown",
        });
        continue;
      }
      const row = await prisma.storeCreditJob.findFirst({
        where: { id: jobId },
        select: { status: true, done: true, count: true },
      });
      if (row) {
        out.push({
          jobId,
          done: row.done,
          total: row.count,
          status: row.status,
        });
      } else {
        out.push({ jobId, done: 0, total: 0, status: "unknown" });
      }
    } catch (e) {
      console.error(`Error fetching progress for store credit job ${jobId}:`, e);
      out.push({ jobId, done: 0, total: 0, status: "error" });
    }
  }
  return out;
}

export async function listStoreCreditJobsForShop(
  shopName: string,
  limit = 50,
) {
  return prisma.storeCreditJob.findMany({
    where: { shopName },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getStoreCreditJobWithRecipients(
  shopName: string,
  jobId: string,
) {
  return prisma.storeCreditJob.findFirst({
    where: { id: jobId, shopName },
    include: {
      recipients: {
        orderBy: { processedAt: "asc" },
        take: 50,
      },
    },
  });
}

import { DateTime } from "luxon";
import prisma from "../../db.server";
import {
  canCreateGiftCardsWithPlan,
  canRunJobsWithPlan,
  getFeatureMinimumPlan,
  getPlanFromBilling,
  hasPlanFeature,
} from "../../services/plan.server";
import {
  CREATE_JOB_RULES,
  getFirstCreateJobValidationError,
  validateCreateJobInput,
} from "../../../shared/create-job";
import { resolveSegmentMemberIds } from "./segments.server";
import { triggerWorkerJob } from "./worker-trigger.server";
import type { authenticate } from "../../shopify.server";
import type { CreateJobBody, CreateJobData } from "../types";

type AdminAuthContext = Awaited<ReturnType<typeof authenticate.admin>>;
type BillingContext = AdminAuthContext["billing"];
type SessionContext = AdminAuthContext["session"];
type AdminGraphqlClient = AdminAuthContext["admin"];

interface CreateJobResult {
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

function buildErrorResult(message: string, status = 400): CreateJobResult {
  return {
    body: { message },
    status,
  };
}

function hasAccessScope(
  scopeString: string | null | undefined,
  requiredScope: string,
): boolean {
  if (!scopeString) {
    return false;
  }

  return scopeString
    .split(",")
    .map((scope) => scope.trim())
    .includes(requiredScope);
}

function extractNumericId(gid: string): string {
  const match = gid.match(/(\d+)$/);
  return match ? match[1] : gid;
}

function isOffsetTimezone(timezone: string): boolean {
  return /^[+-]\d{2}:\d{2}$/.test(timezone) || timezone === "00:00";
}

function resolveTimezone(timezone: string): string {
  if (timezone === "00:00") {
    return "UTC";
  }

  if (isOffsetTimezone(timezone)) {
    return `UTC${timezone}`;
  }

  return timezone;
}

function parseScheduledTimestamp(
  scheduledDate?: string,
  scheduledTime?: string,
  scheduledTimezone?: string,
): ScheduledTimestampResult {
  if (!scheduledDate || !scheduledTime || !scheduledTimezone) {
    return {};
  }

  try {
    const dateTimeStr = `${scheduledDate}T${scheduledTime}:00`;
    const dateTime = DateTime.fromISO(dateTimeStr, {
      zone: resolveTimezone(scheduledTimezone),
    });

    const scheduledTimestamp = dateTime.toUTC().toISO();
    if (!scheduledTimestamp) {
      return { error: "Invalid scheduled delivery date, time, or timezone" };
    }

    const scheduledDateValue = new Date(scheduledTimestamp);
    const now = new Date();
    if (Number.isNaN(scheduledDateValue.getTime())) {
      return { error: "Invalid scheduled delivery date, time, or timezone" };
    }

    if (scheduledDateValue <= now) {
      return { error: "Scheduled delivery time must be in the future" };
    }

    const ninetyDaysFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    if (scheduledDateValue > ninetyDaysFromNow) {
      return { error: "Scheduled delivery time must be within 90 days" };
    }

    return { scheduledTimestamp };
  } catch (error) {
    console.error("Error parsing scheduled time:", error);
    return { error: "Invalid scheduled delivery date, time, or timezone" };
  }
}

export async function createBulkGiftCardJob(
  admin: AdminGraphqlClient,
  billing: BillingContext,
  session: SessionContext,
  body: CreateJobBody,
): Promise<CreateJobResult> {
  const {
    value,
    count,
    note,
    prefix,
    postfix,
    codeLength,
    savePreset,
    presetName,
    expireDate,
    customerIds,
    segmentIds,
    scheduledDate,
    scheduledTime,
    scheduledMessage,
    scheduledTimezone,
    giftCardCurrency,
  } = body;

  const segmentIdInputs = Array.isArray(segmentIds) ? segmentIds.filter(Boolean) : [];
  const hasRecipients = Boolean(customerIds) || segmentIdInputs.length > 0;

  const baseValidationError = getFirstCreateJobValidationError(
    validateCreateJobInput(body, {
      hasCustomerIds: hasRecipients,
      isUnlimited: true,
      remaining: Number.POSITIVE_INFINITY,
    }),
  );

  if (baseValidationError) {
    return buildErrorResult(baseValidationError);
  }

  const finalCodeLength = codeLength || CREATE_JOB_RULES.codeLengthDefault;

  if (expireDate) {
    const expireAtEndOfDay = new Date(`${expireDate}T23:59:59.999`);
    if (Number.isNaN(expireAtEndOfDay.getTime()) || expireAtEndOfDay <= new Date()) {
      return buildErrorResult("Expire date must be in the future");
    }
  }

  if (savePreset && !presetName?.trim()) {
    return buildErrorResult("Preset name is required");
  }

  if (presetName && presetName.length > CREATE_JOB_RULES.presetMaxChars) {
    return buildErrorResult(
      `Preset name cannot exceed ${CREATE_JOB_RULES.presetMaxChars} characters`,
    );
  }

  const plan = await getPlanFromBilling(admin, billing, session.shop);
  const subscriptionPlanId = plan.id;

  if (hasRecipients && !hasPlanFeature(plan, "send-by-email")) {
    return buildErrorResult(
      `Email delivery to customers requires the ${getFeatureMinimumPlan("send-by-email")} plan or higher`,
      403,
    );
  }

  if (hasRecipients && !hasAccessScope(session.scope, "write_customers")) {
    return buildErrorResult(
      "Sending gift cards to customers requires the Shopify write_customers scope. Reinstall or reauthorize the app, then try again.",
      403,
    );
  }

  if (savePreset && !hasPlanFeature(plan, "job-presets")) {
    return buildErrorResult(
      `Job presets require the ${getFeatureMinimumPlan("job-presets")} plan or higher`,
      403,
    );
  }

  const hasSchedulingFields = Boolean(
    scheduledDate || scheduledTime || scheduledTimezone || scheduledMessage,
  );

  if (hasSchedulingFields && !hasRecipients) {
    return buildErrorResult(
      "Scheduled delivery is only available for customer email jobs",
    );
  }

  if (
    hasRecipients &&
    hasSchedulingFields &&
    (!scheduledDate || !scheduledTime || !scheduledTimezone)
  ) {
    return buildErrorResult("Scheduled date, time, and timezone are all required");
  }

  const { scheduledTimestamp, error: scheduledTimestampError } = parseScheduledTimestamp(
    scheduledDate,
    scheduledTime,
    scheduledTimezone,
  );

  if (scheduledTimestampError) {
    return buildErrorResult(scheduledTimestampError);
  }

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [monthlyUsage, activeJobCount] = await Promise.all([
    prisma.job.aggregate({
      where: {
        shopName: session.shop,
        createdAt: { gte: startOfMonth },
        status: { in: ["scheduled", "pending", "running", "completed"] },
        jobType: { not: "deactivate" },
      },
      _sum: { count: true },
    }),
    prisma.job.count({
      where: {
        shopName: session.shop,
        status: { in: ["pending", "running"] },
      },
    }),
  ]);

  const totalGiftCardsCreatedThisMonth = monthlyUsage._sum.count || 0;
  if (!canCreateGiftCardsWithPlan(plan, totalGiftCardsCreatedThisMonth, count)) {
    const remaining = Math.max(0, plan.maxGiftCards - totalGiftCardsCreatedThisMonth);
    return buildErrorResult(
      `Your ${plan.name} plan allows ${plan.maxGiftCards} gift cards per month. You can create ${remaining} more this month.`,
    );
  }

  if (!canRunJobsWithPlan(plan, activeJobCount)) {
    return buildErrorResult(
      `Your ${plan.name} plan allows ${plan.jobs} running job(s) at once. Please wait for an active job to finish.`,
    );
  }

  let customerIdString: string | null = null;
  if (hasRecipients) {
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

    const rawIds = customerIds
      ? Array.isArray(customerIds)
        ? customerIds
        : [customerIds]
      : [];
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

    if (
      !canCreateGiftCardsWithPlan(
        plan,
        totalGiftCardsCreatedThisMonth,
        numericIds.length,
      )
    ) {
      const remaining = Math.max(
        0,
        plan.maxGiftCards - totalGiftCardsCreatedThisMonth,
      );
      return buildErrorResult(
        `Your ${plan.name} plan allows ${plan.maxGiftCards} gift cards per month. You can create ${remaining} more this month.`,
      );
    }

    customerIdString = numericIds.join(",");
  }

  const jobId = crypto.randomUUID();

  let presetId: string | undefined;
  if (savePreset && presetName && hasPlanFeature(plan, "job-presets")) {
    presetId = crypto.randomUUID();
    await prisma.preset.create({
      data: {
        id: presetId,
        name: presetName.trim().slice(0, CREATE_JOB_RULES.presetMaxChars),
        count,
        value,
        note: note || null,
        prefix: prefix || null,
        postfix: postfix || null,
        codeLength: finalCodeLength,
        shopName: session.shop,
        giftCardCurrency: giftCardCurrency || null,
      },
    });
  }

  // For email jobs, the canonical count is the number of customer IDs.
  const finalCount = customerIdString ? customerIdString.split(",").length : count;

  const jobData: CreateJobData = {
    id: jobId,
    count: finalCount,
    value,
    note: note || undefined,
    shopName: session.shop,
    userId: session.onlineAccessInfo?.associated_user?.id
      ? BigInt(session.onlineAccessInfo.associated_user.id)
      : 0,
    status: scheduledTimestamp ? "scheduled" : "pending",
    createdAt: new Date(),
    prefix: prefix || undefined,
    postfix: postfix || undefined,
    codeLength: finalCodeLength,
    expireDate: expireDate || null,
    subscriptionPlanId,
    customerIds: customerIdString,
    scheduledDate,
    scheduledTime,
    scheduledTimezone,
    scheduledTimestamp,
    scheduledMessage: scheduledMessage || undefined,
    giftCardCurrency: giftCardCurrency || undefined,
  };

  await prisma.job.create({
    data: {
      id: jobData.id,
      count: jobData.count,
      value: jobData.value,
      note: jobData.note || null,
      shopName: jobData.shopName,
      userId: jobData.userId ? BigInt(jobData.userId) : null,
      status: jobData.status,
      createdAt: jobData.createdAt,
      prefix: jobData.prefix || null,
      postfix: jobData.postfix || null,
      codeLength: jobData.codeLength,
      expireDate: jobData.expireDate,
      subscriptionPlanId: jobData.subscriptionPlanId,
      customerIds: jobData.customerIds,
      presetId: presetId || null,
      scheduledDate: jobData.scheduledDate || null,
      scheduledTime: jobData.scheduledTime || null,
      scheduledTimezone: jobData.scheduledTimezone || null,
      scheduledTimestamp: jobData.scheduledTimestamp || null,
      scheduledMessage: jobData.scheduledMessage || null,
      giftCardCurrency: jobData.giftCardCurrency || null,
    },
  });

  // Scheduled jobs are dispatched by the Go worker's background scheduler loop.
  if (!scheduledTimestamp) {
    try {
      await triggerWorkerJob(jobId, session.shop);
    } catch (error) {
      console.error("Error triggering worker for job:", jobId, error);
      // Mark job as failed so the user can retry instead of it sitting in pending forever
      await prisma.job.update({
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
      message: "Job created successfully",
      jobId,
      status: jobData.status,
    },
    status: 201,
  };
}

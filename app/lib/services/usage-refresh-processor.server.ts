import prisma from "../../db.server";
import { trackGiftCardUsageForShop } from "./gift-card-tracker.server";
import {
  dequeueUsageRefresh,
  setUsageRefreshProgress,
} from "./usage-refresh-queue.server";

let isProcessingUsageRefreshQueue = false;

/**
 * Process the next queued usage refresh job.
 * Designed to be called from a background worker or deferred task.
 */
export async function processNextUsageRefresh(): Promise<boolean> {
  const refreshJob = await dequeueUsageRefresh();
  if (!refreshJob) return false;

  const { jobId, shop } = refreshJob;

  try {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { giftCards: true },
    });

    if (!job) {
      await setUsageRefreshProgress(jobId, {
        status: "failed",
        error: "Job not found",
      });
      return true;
    }

    const giftCards = job.giftCards as Array<{ id: number; value: number }> | null;

    if (!giftCards || giftCards.length === 0) {
      await setUsageRefreshProgress(jobId, {
        status: "failed",
        error: "No gift cards found",
      });
      return true;
    }

    await setUsageRefreshProgress(jobId, {
      status: "processing",
      done: 0,
      total: giftCards.length,
    });

    await trackGiftCardUsageForShop(shop, jobId, giftCards, async (done, total) => {
      await setUsageRefreshProgress(jobId, {
        status: "processing",
        done,
        total,
      });
    });

    await setUsageRefreshProgress(jobId, {
      status: "completed",
      done: giftCards.length,
      total: giftCards.length,
    });

    return true;
  } catch (error) {
    console.error(`Error processing usage refresh for job ${jobId}:`, error);
    await setUsageRefreshProgress(jobId, {
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return true;
  }
}

/**
 * Drain the usage refresh queue.
 * Uses a simple in-process lock to avoid concurrent drainers within the same app instance.
 */
export async function processAllUsageRefreshes(): Promise<number> {
  if (isProcessingUsageRefreshQueue) {
    return 0;
  }

  isProcessingUsageRefreshQueue = true;
  let processed = 0;

  try {
    let hasMore = true;
    while (hasMore) {
      hasMore = await processNextUsageRefresh();
      if (hasMore) processed++;
    }

    return processed;
  } finally {
    isProcessingUsageRefreshQueue = false;
  }
}

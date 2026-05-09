import redisClient from "../../redis.server";
import type { UsageRefreshProgress } from "../types";

const QUEUE_KEY = "usage_refresh_queue";
const PROGRESS_PREFIX = "usage_refresh_progress:";
const PROGRESS_TTL = 3600; // 1 hour

export interface UsageRefreshJob {
  jobId: string;
  shop: string;
  enqueuedAt: string;
}

/**
 * Enqueue a usage refresh job for background processing.
 */
export async function enqueueUsageRefresh(jobId: string, shop: string): Promise<void> {
  const job: UsageRefreshJob = {
    jobId,
    shop,
    enqueuedAt: new Date().toISOString(),
  };

  await redisClient.lpush(QUEUE_KEY, JSON.stringify(job));

  // Initialize progress tracking
  await setUsageRefreshProgress(jobId, {
    status: "queued",
    done: 0,
    total: 0,
  });
}

/**
 * Dequeue the next usage refresh job.
 */
export async function dequeueUsageRefresh(): Promise<UsageRefreshJob | null> {
  const raw = await redisClient.rpop(QUEUE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as UsageRefreshJob;
  } catch {
    return null;
  }
}

/**
 * Get the current progress of a usage refresh job.
 */
export async function getUsageRefreshProgress(
  jobId: string,
): Promise<UsageRefreshProgress | null> {
  const raw = await redisClient.hgetall(`${PROGRESS_PREFIX}${jobId}`);

  if (!raw || Object.keys(raw).length === 0) {
    return null;
  }

  return {
    status: (raw.status || "queued") as UsageRefreshProgress["status"],
    done: parseInt(raw.done || "0", 10),
    total: parseInt(raw.total || "0", 10),
    error: raw.error || undefined,
  };
}

/**
 * Update progress for a usage refresh job.
 */
export async function setUsageRefreshProgress(
  jobId: string,
  progress: Partial<UsageRefreshProgress>,
): Promise<void> {
  const key = `${PROGRESS_PREFIX}${jobId}`;
  const fields: Record<string, string> = {};

  if (progress.status !== undefined) fields.status = progress.status;
  if (progress.done !== undefined) fields.done = String(progress.done);
  if (progress.total !== undefined) fields.total = String(progress.total);
  if (progress.error !== undefined) fields.error = progress.error;

  if (Object.keys(fields).length > 0) {
    await redisClient.hmset(key, fields);
    await redisClient.expire(key, PROGRESS_TTL);
  }
}

/**
 * Clear progress tracking for a job.
 */
export async function clearUsageRefreshProgress(jobId: string): Promise<void> {
  await redisClient.del(`${PROGRESS_PREFIX}${jobId}`);
}

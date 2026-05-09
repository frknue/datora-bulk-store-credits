import prisma from "../../db.server";
import redisClient from "../../redis.server";
import type { JobProgress } from "../types";

export async function getJobsProgress(jobIds: string[]): Promise<JobProgress[]> {
  const progress: JobProgress[] = [];

  for (const jobId of jobIds) {
    try {
      const redisData = await redisClient.hgetall(`job_status:${jobId}`);

      if (redisData && Object.keys(redisData).length > 0) {
        progress.push({
          jobId,
          done: parseInt(redisData.done || "0", 10),
          total: parseInt(redisData.total || "0", 10),
          status: redisData.status || "unknown",
        });
      } else {
        // Fall back to database when Redis key is missing or expired
        const job = await prisma.job.findFirst({
          where: { id: jobId },
          select: { status: true, done: true, count: true },
        });
        if (job) {
          progress.push({
            jobId,
            done: job.done,
            total: job.count,
            status: job.status,
          });
        } else {
          progress.push({ jobId, done: 0, total: 0, status: "unknown" });
        }
      }
    } catch (error) {
      console.error(`Error fetching progress for job ${jobId}:`, error);
      progress.push({ jobId, done: 0, total: 0, status: "error" });
    }
  }

  return progress;
}

import prisma from "../../db.server";

export const STORE_CREDIT_DASHBOARD_JOBS_PER_PAGE = 20;

const MONTHLY_STATUSES = ["scheduled", "pending", "running", "completed", "completed_with_errors"];

function startOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export async function loadStoreCreditDashboardData(
  shopName: string,
  page: number,
) {
  const skip = (page - 1) * STORE_CREDIT_DASHBOARD_JOBS_PER_PAGE;
  const monthStart = startOfMonth();

  const [
    jobs,
    totalJobs,
    statusCounts,
    recipientsThisMonth,
    recipientsAllTime,
    recipientProcessedCounts,
    userSettings,
  ] = await Promise.all([
    prisma.storeCreditJob.findMany({
      where: { shopName },
      orderBy: { createdAt: "desc" },
      skip,
      take: STORE_CREDIT_DASHBOARD_JOBS_PER_PAGE,
    }),
    prisma.storeCreditJob.count({ where: { shopName } }),
    prisma.storeCreditJob.groupBy({
      by: ["status"],
      where: { shopName },
      _count: { status: true },
    }),
    prisma.storeCreditJob.aggregate({
      where: {
        shopName,
        createdAt: { gte: monthStart },
        status: { in: MONTHLY_STATUSES },
      },
      _sum: { count: true },
    }),
    prisma.storeCreditJob.aggregate({
      where: {
        shopName,
        status: { in: MONTHLY_STATUSES },
      },
      _sum: { count: true },
    }),
    // Aggregate per-recipient outcomes to compute a recipient-level success rate.
    prisma.storeCreditJobRecipient.groupBy({
      by: ["status"],
      where: { job: { shopName } },
      _count: { status: true },
    }),
    prisma.user.findUnique({ where: { shopName } }),
  ]);

  const getJobStatusCount = (status: string) =>
    statusCounts.find((s) => s.status === status)?._count.status ?? 0;
  const getRecipientStatusCount = (status: string) =>
    recipientProcessedCounts.find((s) => s.status === status)?._count.status ??
    0;

  const runningCount = getJobStatusCount("running");
  const pendingCount = getJobStatusCount("pending");

  const succeededRecipients = getRecipientStatusCount("succeeded");
  const failedRecipients = getRecipientStatusCount("failed");
  const processedRecipients = succeededRecipients + failedRecipients;
  const successRate =
    processedRecipients > 0
      ? Math.round((succeededRecipients / processedRecipients) * 100)
      : 100;

  const storeCreditThisMonth = recipientsThisMonth._sum.count ?? 0;
  const storeCreditAllTime = recipientsAllTime._sum.count ?? 0;

  return {
    jobs: jobs.map((j) => ({
      id: j.id,
      createdAt: j.createdAt.toISOString(),
      amount: j.amount.toString(),
      currency: j.currency,
      count: j.count,
      done: j.done,
      failed: j.failed,
      status: j.status,
      scheduledTimestamp: j.scheduledTimestamp,
      note: j.note,
    })),
    totalJobs,
    page,
    totalPages: Math.ceil(totalJobs / STORE_CREDIT_DASHBOARD_JOBS_PER_PAGE),
    runningCount,
    pendingCount,
    storeCreditRecipientsAllTime: storeCreditAllTime,
    storeCreditRecipientsThisMonth: storeCreditThisMonth,
    succeededRecipients,
    failedRecipients,
    successRate,
    showCard: userSettings?.showCard ?? true,
    showContactCard: userSettings?.showContactCard ?? true,
  };
}

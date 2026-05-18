import prisma from "../../db.server";

export const DASHBOARD_JOBS_PER_PAGE = 20;

export async function dismissFeatureCard(shopName: string) {
  await prisma.user.upsert({
    where: { shopName },
    update: { showCard: false },
    create: { shopName, showCard: false },
  });
}

export async function dismissContactCard(shopName: string) {
  await prisma.user.upsert({
    where: { shopName },
    update: { showContactCard: false },
    create: { shopName, showContactCard: false },
  });
}

export async function dismissSetupGuide(shopName: string) {
  await prisma.user.upsert({
    where: { shopName },
    update: { setupGuideDismissedAt: new Date() },
    create: { shopName, setupGuideDismissedAt: new Date() },
  });
}

export async function loadDashboardPageData(shopName: string, page: number) {
  const skip = (page - 1) * DASHBOARD_JOBS_PER_PAGE;

  const [
    jobs,
    totalJobs,
    statusCounts,
    monthlyStats,
    allTimeStats,
    totalValueResult,
    userSettings,
  ] = await Promise.all([
    prisma.job.findMany({
      where: { shopName, jobType: { not: "deactivate" } },
      orderBy: { createdAt: "desc" },
      skip,
      take: DASHBOARD_JOBS_PER_PAGE,
      select: {
        id: true,
        count: true,
        done: true,
        value: true,
        status: true,
        createdAt: true,
        finishedAt: true,
        prefix: true,
        postfix: true,
        codeLength: true,
        note: true,
        expireDate: true,
        customerIds: true,
        scheduledDate: true,
        scheduledTime: true,
        scheduledTimezone: true,
        scheduledMessage: true,
        subscriptionPlanId: true,
        errorMessage: true,
        giftCardCurrency: true,
        deactivatedAt: true,
      },
    }),
    prisma.job.count({ where: { shopName, jobType: { not: "deactivate" } } }),
    prisma.job.groupBy({
      by: ["status"],
      where: { shopName, jobType: { not: "deactivate" } },
      _count: { status: true },
    }),
    prisma.job.aggregate({
      where: {
        shopName,
        jobType: { not: "deactivate" },
        createdAt: {
          gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        },
        status: { in: ["scheduled", "completed", "running", "pending"] },
      },
      _sum: { count: true },
    }),
    prisma.job.aggregate({
      where: {
        shopName,
        jobType: { not: "deactivate" },
        status: { in: ["scheduled", "completed", "running", "pending"] },
      },
      _sum: { count: true },
    }),
    prisma.$queryRaw<[{ total: string }]>`
      SELECT COALESCE(SUM("count" * "value"), 0)::text as total
      FROM "Job"
      WHERE "shop_name" = ${shopName}
        AND "status" IN ('scheduled', 'completed', 'running', 'pending')
        AND ("job_type" IS NULL OR "job_type" != 'deactivate')
    `,
    prisma.user.findUnique({ where: { shopName } }),
  ]);

  const getStatusCount = (status: string) =>
    statusCounts.find((s) => s.status === status)?._count.status ?? 0;

  const runningCount = getStatusCount("running");
  const pendingCount = getStatusCount("pending");
  const completedCount = getStatusCount("completed");
  const failedCount = getStatusCount("failed");
  const cancelledCount = getStatusCount("cancelled");

  const totalGiftCardsThisMonth = monthlyStats._sum.count || 0;
  const totalGiftCardsAllTime = allTimeStats._sum.count || 0;
  const totalValueGenerated = Number(totalValueResult[0]?.total ?? 0);

  const finishedJobs = completedCount + failedCount + cancelledCount;
  const successRate =
    finishedJobs > 0 ? Math.round((completedCount / finishedJobs) * 100) : 100;

  // Find source jobs on this page that have an active deactivation job.
  const jobIds = jobs.map((j) => j.id);
  const activeDeactivations =
    jobIds.length > 0
      ? await prisma.job.findMany({
          where: {
            sourceJobId: { in: jobIds },
            jobType: "deactivate",
            status: { in: ["pending", "running"] },
          },
          select: { id: true, sourceJobId: true },
        })
      : [];

  // Map: sourceJobId → deactivation job ID (for progress polling)
  const deactivatingJobMap: Record<string, string> = {};
  for (const d of activeDeactivations) {
    if (d.sourceJobId) {
      deactivatingJobMap[d.sourceJobId] = d.id;
    }
  }

  return {
    jobs: jobs.map((job) => ({ ...job, value: Number(job.value) })),
    totalJobs,
    page,
    totalPages: Math.ceil(totalJobs / DASHBOARD_JOBS_PER_PAGE),
    runningCount,
    pendingCount,
    totalGiftCardsThisMonth,
    totalGiftCardsAllTime,
    totalValueGenerated,
    successRate,
    completedJobCount: completedCount,
    showCard: userSettings?.showCard ?? true,
    showContactCard: userSettings?.showContactCard ?? true,
    shopName,
    deactivatingJobMap,
  };
}

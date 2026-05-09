import prisma from "../../db.server";

const GIFT_CARD_MONTHLY_STATUSES = ["scheduled", "completed", "running", "pending"];
const STORE_CREDIT_MONTHLY_STATUSES = [
  "scheduled",
  "pending",
  "running",
  "completed",
  "completed_with_errors",
];
const RECENT_ACTIVITY_LIMIT = 10;

function startOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export type OverviewRecentFeature = "gift_card" | "store_credit";

export interface OverviewRecentJob {
  feature: OverviewRecentFeature;
  id: string;
  status: string;
  count: number;
  amount: number;
  currency: string;
  createdAt: string;
}

export async function loadOverviewData(shopName: string) {
  const monthStart = startOfMonth();

  const [
    giftMonthly,
    giftAllTime,
    giftActive,
    creditMonthly,
    creditAllTime,
    creditActive,
    recentGiftCards,
    recentStoreCredits,
    userSettings,
  ] = await Promise.all([
    prisma.job.aggregate({
      where: {
        shopName,
        createdAt: { gte: monthStart },
        status: { in: GIFT_CARD_MONTHLY_STATUSES },
        jobType: { not: "deactivate" },
      },
      _sum: { count: true },
    }),
    prisma.job.aggregate({
      where: {
        shopName,
        status: { in: GIFT_CARD_MONTHLY_STATUSES },
        jobType: { not: "deactivate" },
      },
      _sum: { count: true },
    }),
    prisma.job.groupBy({
      by: ["status"],
      where: { shopName, jobType: { not: "deactivate" } },
      _count: { status: true },
    }),
    prisma.storeCreditJob.aggregate({
      where: {
        shopName,
        createdAt: { gte: monthStart },
        status: { in: STORE_CREDIT_MONTHLY_STATUSES },
      },
      _sum: { count: true },
    }),
    prisma.storeCreditJob.aggregate({
      where: {
        shopName,
        status: { in: STORE_CREDIT_MONTHLY_STATUSES },
      },
      _sum: { count: true },
    }),
    prisma.storeCreditJob.groupBy({
      by: ["status"],
      where: { shopName },
      _count: { status: true },
    }),
    prisma.job.findMany({
      where: { shopName, jobType: { not: "deactivate" } },
      orderBy: { createdAt: "desc" },
      take: RECENT_ACTIVITY_LIMIT,
      select: {
        id: true,
        status: true,
        count: true,
        value: true,
        giftCardCurrency: true,
        createdAt: true,
      },
    }),
    prisma.storeCreditJob.findMany({
      where: { shopName },
      orderBy: { createdAt: "desc" },
      take: RECENT_ACTIVITY_LIMIT,
      select: {
        id: true,
        status: true,
        count: true,
        amount: true,
        currency: true,
        createdAt: true,
      },
    }),
    prisma.user.findUnique({ where: { shopName } }),
  ]);

  const countForStatus = (
    rows: { status: string; _count: { status: number } }[],
    status: string,
  ) => rows.find((r) => r.status === status)?._count.status ?? 0;

  const giftRunning = countForStatus(giftActive, "running");
  const giftPending = countForStatus(giftActive, "pending");
  const creditRunning = countForStatus(creditActive, "running");
  const creditPending = countForStatus(creditActive, "pending");

  const recent: OverviewRecentJob[] = [
    ...recentGiftCards.map((j) => ({
      feature: "gift_card" as const,
      id: j.id,
      status: j.status,
      count: j.count,
      amount: Number(j.value),
      currency: j.giftCardCurrency ?? "",
      createdAt: j.createdAt.toISOString(),
    })),
    ...recentStoreCredits.map((j) => ({
      feature: "store_credit" as const,
      id: j.id,
      status: j.status,
      count: j.count,
      amount: Number(j.amount),
      currency: j.currency,
      createdAt: j.createdAt.toISOString(),
    })),
  ]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, RECENT_ACTIVITY_LIMIT);

  return {
    giftMonthlyUsed: giftMonthly._sum.count ?? 0,
    giftAllTime: giftAllTime._sum.count ?? 0,
    giftRunning,
    giftPending,
    creditMonthlyUsed: creditMonthly._sum.count ?? 0,
    creditAllTime: creditAllTime._sum.count ?? 0,
    creditRunning,
    creditPending,
    recent,
    showCard: userSettings?.showCard ?? true,
    showContactCard: userSettings?.showContactCard ?? true,
  };
}

import prisma from "../../db.server";

export async function loadCreateJobPageData(
  shopName: string,
  extensionCustomerIds: string,
) {
  const [presets, monthlyStats] = await Promise.all([
    prisma.preset.findMany({
      where: { shopName },
      orderBy: { createdAt: "desc" },
    }),
    prisma.job.aggregate({
      where: {
        shopName,
        createdAt: {
          gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        },
        status: { in: ["scheduled", "completed", "running", "pending"] },
      },
      _sum: { count: true },
    }),
  ]);

  return {
    presets: presets.map((preset) => ({ ...preset, value: Number(preset.value) })),
    totalGiftCardsCreated: monthlyStats._sum.count || 0,
    extensionCustomerIds,
    shopName,
  };
}

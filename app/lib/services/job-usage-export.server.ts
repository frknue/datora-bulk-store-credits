import prisma from "../../db.server";
import { canUseUsageTracking } from "../subscriptions/plans";
import { convertRowsToCsv } from "./csv.server";

interface BuildJobUsageExportResponseOptions {
  currentPlanId: number;
  jobId: string;
  shopName: string;
  delimiter: string;
}

export async function buildJobUsageExportResponse({
  currentPlanId,
  jobId,
  shopName,
  delimiter,
}: BuildJobUsageExportResponseOptions): Promise<Response> {
  if (!canUseUsageTracking(currentPlanId)) {
    return Response.json(
      { message: "Usage export requires Premium or Ultimate plan" },
      { status: 403 },
    );
  }

  const job = await prisma.job.findFirst({
    where: { id: jobId, shopName },
    select: { id: true },
  });

  if (!job) {
    return Response.json({ message: "job not found" }, { status: 404 });
  }

  const usageRecords = await prisma.giftCardUsage.findMany({
    where: { jobId },
    orderBy: { createdAt: "asc" },
  });

  if (usageRecords.length === 0) {
    return Response.json(
      { message: "No usage data available. Please refresh first." },
      { status: 404 },
    );
  }

  const csvRows = usageRecords.map((record) => ({
    gift_card_id: record.giftCardId,
    last_characters: record.lastCharacters,
    initial_value: Number(record.initialValue).toFixed(2),
    current_balance: Number(record.currentBalance).toFixed(2),
    amount_redeemed: Number(record.amountRedeemed).toFixed(2),
    status: record.status,
    balance_status: record.balanceStatus,
    last_checked_at: record.lastCheckedAt.toISOString(),
  }));

  const csvContent = convertRowsToCsv(csvRows, delimiter);

  return new Response(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="usage_${jobId}.csv"`,
    },
  });
}

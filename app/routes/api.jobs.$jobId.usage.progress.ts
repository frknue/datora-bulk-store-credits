import { data } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getUsageRefreshProgress } from "../lib/services/usage-refresh-queue.server";
import { canUseUsageTracking } from "../lib/subscriptions/plans";
import { getPlanFromBilling } from "../services/plan.server";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const { jobId } = params;

  if (!jobId) return data({ message: "no jobId" }, { status: 400 });

  const plan = await getPlanFromBilling(admin, billing, session.shop);
  if (!canUseUsageTracking(plan.id)) {
    return data(
      {
        message: `Gift card usage tracking is available for Premium and higher plans only`,
      },
      { status: 403 },
    );
  }

  // Verify job belongs to the authenticated shop
  const job = await prisma.job.findFirst({
    where: { id: jobId, shopName: session.shop },
    select: { id: true },
  });
  if (!job) return data({ message: "job not found" }, { status: 404 });

  const progress = await getUsageRefreshProgress(jobId);

  return { progress };
};

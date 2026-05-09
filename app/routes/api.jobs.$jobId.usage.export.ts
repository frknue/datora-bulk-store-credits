import { authenticate } from "../shopify.server";
import { buildJobUsageExportResponse } from "../lib/services/job-usage-export.server";
import { getPlanFromBilling } from "../services/plan.server";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const { jobId } = params;
  const subscriptionPlan = await getPlanFromBilling(billing, session.shop);

  if (!jobId) {
    return Response.json({ message: "no jobId" }, { status: 400 });
  }

  const url = new URL(request.url);
  return buildJobUsageExportResponse({
    currentPlanId: subscriptionPlan.id,
    jobId,
    shopName: session.shop,
    delimiter: url.searchParams.get("d") === "semicolon" ? ";" : ",",
  });
};

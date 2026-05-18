import { authenticate } from "../shopify.server";
import { buildJobDownloadResponse } from "../lib/services/job-download.server";
import { getPlanFromBilling } from "../services/plan.server";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const { jobid, subscriptionid } = params;

  if (!jobid || !subscriptionid) {
    return Response.json({ message: "missing parameters" }, { status: 400 });
  }

  const currentPlan = await getPlanFromBilling(admin, billing, session.shop);

  const url = new URL(request.url);
  return buildJobDownloadResponse({
    jobId: jobid,
    shopName: session.shop,
    currentPlan,
    fieldsParam: url.searchParams.get("f") || "all",
    delimiter: url.searchParams.get("d") === "semicolon" ? ";" : ",",
    uppercase: url.searchParams.get("u") === "true",
    splitted: url.searchParams.get("s") === "true",
  });
};

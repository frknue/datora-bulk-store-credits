import { authenticate } from "../shopify.server";
import { buildBatchJobDownloadResponse } from "../lib/services/job-download.server";
import { getPlanFromBilling } from "../services/plan.server";
import type { ActionFunctionArgs } from "react-router";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);

  if (request.method !== "POST") {
    return Response.json({ message: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json();
  const { jobIds, fields, delimiter, uppercase, splitter } = body;

  if (!Array.isArray(jobIds) || jobIds.length === 0) {
    return Response.json({ message: "No job IDs provided" }, { status: 400 });
  }

  if (jobIds.length > 50) {
    return Response.json(
      { message: "Maximum 50 jobs per batch download" },
      { status: 400 },
    );
  }

  const currentPlan = await getPlanFromBilling(billing, session.shop);

  return buildBatchJobDownloadResponse({
    jobIds,
    shopName: session.shop,
    currentPlan,
    fieldsParam: fields || "all",
    delimiter: delimiter === "semicolon" ? ";" : ",",
    uppercase: uppercase === true,
    splitted: splitter === true,
  });
};

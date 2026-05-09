import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getJobsProgress } from "../lib/services/job-progress.server";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const jobIds = (url.searchParams.get("ids") || "").split(",").filter(Boolean);

  if (jobIds.length === 0) return [];

  // Only allow progress queries for jobs belonging to this shop
  const ownedJobs = await prisma.job.findMany({
    where: { id: { in: jobIds }, shopName: session.shop },
    select: { id: true },
  });
  const ownedJobIds = ownedJobs.map((j) => j.id);

  if (ownedJobIds.length === 0) return [];

  return await getJobsProgress(ownedJobIds);
};

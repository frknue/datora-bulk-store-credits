import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getStoreCreditJobsProgress } from "../lib/services/store-credit.server";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const jobIds = (url.searchParams.get("ids") || "").split(",").filter(Boolean);

  if (jobIds.length === 0) return [];

  const owned = await prisma.storeCreditJob.findMany({
    where: { id: { in: jobIds }, shopName: session.shop },
    select: { id: true },
  });
  const ownedIds = owned.map((j) => j.id);
  if (ownedIds.length === 0) return [];

  return await getStoreCreditJobsProgress(ownedIds);
};

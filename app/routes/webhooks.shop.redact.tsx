import { authenticate } from "../shopify.server";
import db from "../db.server";
import type { ActionFunctionArgs } from "react-router";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  // Delete all app data for the shop
  await db.giftCardUsage.deleteMany({
    where: { job: { shopName: shop } },
  });
  await db.job.deleteMany({ where: { shopName: shop } });
  await db.preset.deleteMany({ where: { shopName: shop } });
  await db.user.deleteMany({ where: { shopName: shop } });

  return new Response();
};

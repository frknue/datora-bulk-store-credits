import { authenticate } from "../shopify.server";
import db from "../db.server";
import type { ActionFunctionArgs } from "react-router";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // BFS 4.2.2 — onboarding must appear on each new install and reinstall.
  // Clear the dismiss timestamp so the Getting Started card surfaces again
  // if the merchant ever reinstalls.
  await db.user.updateMany({
    where: { shopName: shop },
    data: { setupGuideDismissedAt: null },
  });

  return new Response();
};

import prisma from "../../db.server";

export type SetupGuideStepId =
  | "choose-plan"
  | "issue-store-credit"
  | "create-gift-card"
  | "send-by-email"
  | "set-up-slack";

export type SetupGuideCompletion = {
  /**
   * Per-step completion. The "choose-plan" entry here only reflects whether
   * the merchant has viewed /app/subscriptions; callers should OR this with
   * `subscriptionPlan.name !== "Free"` from the outlet context so that
   * paying merchants are also marked complete.
   */
  steps: Record<SetupGuideStepId, boolean>;
};

export async function computeSetupGuideCompletion(
  shopName: string,
): Promise<SetupGuideCompletion> {
  const [user, giftCardJobCount, emailJobCount, storeCreditJobCount] =
    await Promise.all([
      prisma.user.findUnique({
        where: { shopName },
        select: {
          slackWebhookUrl: true,
          subscriptionsPageViewedAt: true,
        },
      }),
      prisma.job.count({
        where: { shopName, jobType: { not: "deactivate" } },
      }),
      prisma.job.count({
        where: {
          shopName,
          jobType: { not: "deactivate" },
          customerIds: { not: null },
        },
      }),
      prisma.storeCreditJob.count({ where: { shopName } }),
    ]);

  return {
    steps: {
      "choose-plan": Boolean(user?.subscriptionsPageViewedAt),
      "issue-store-credit": storeCreditJobCount > 0,
      "create-gift-card": giftCardJobCount > 0,
      "send-by-email": emailJobCount > 0,
      "set-up-slack": Boolean(user?.slackWebhookUrl),
    },
  };
}

export async function markSubscriptionsPageViewed(
  shopName: string,
): Promise<void> {
  // Two-step so we can use updateMany's null-guard atomically, while still
  // creating the User row if it doesn't exist yet. Wrapped in try/catch by
  // the caller so a DB hiccup never blocks page rendering.
  await prisma.user.upsert({
    where: { shopName },
    update: {},
    create: { shopName, subscriptionsPageViewedAt: new Date() },
  });
  await prisma.user.updateMany({
    where: { shopName, subscriptionsPageViewedAt: null },
    data: { subscriptionsPageViewedAt: new Date() },
  });
}

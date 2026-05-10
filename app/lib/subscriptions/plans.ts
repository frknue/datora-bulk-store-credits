export interface SubscriptionPlan {
  id: number;
  name: string;
  price: number;
  maxGiftCards: number;
  maxStoreCredits: number;
  jobs: number;
  support: boolean;
  downloadDays: number;
  downloadName: string;
  duplicate: boolean;
  extension: boolean;
  presets: boolean;
  formatter: boolean;
  usageTracking: boolean;
  deactivation: boolean;
  slackNotifications: boolean;
}

export const paidPlanNames = ["Basic", "Premium", "Ultimate"] as const;
export type PaidPlanName = (typeof paidPlanNames)[number];

export const subscriptionPlans: SubscriptionPlan[] = [
  {
    id: 1,
    name: "Free",
    price: 0,
    maxGiftCards: 0,
    maxStoreCredits: 50,
    jobs: 1,
    support: false,
    downloadDays: 1,
    downloadName: "1 Day",
    duplicate: false,
    extension: false,
    presets: false,
    formatter: false,
    usageTracking: false,
    deactivation: false,
    slackNotifications: false,
  },
  {
    id: 2,
    name: "Basic",
    price: 9.95,
    maxGiftCards: 250,
    maxStoreCredits: 750,
    jobs: 1,
    support: false,
    downloadDays: -1,
    downloadName: "unlimited",
    duplicate: true,
    extension: true,
    presets: false,
    formatter: true,
    usageTracking: false,
    deactivation: false,
    slackNotifications: false,
  },
  {
    id: 3,
    name: "Premium",
    price: 39.95,
    maxGiftCards: 2500,
    maxStoreCredits: 7500,
    jobs: 3,
    support: true,
    downloadDays: 30,
    downloadName: "1 Month",
    duplicate: true,
    extension: true,
    presets: true,
    formatter: true,
    usageTracking: true,
    deactivation: true,
    slackNotifications: true,
  },
  {
    id: 4,
    name: "Ultimate",
    price: 99.95,
    maxGiftCards: -1,
    maxStoreCredits: -1,
    jobs: 5,
    support: true,
    downloadDays: -1,
    downloadName: "unlimited",
    duplicate: true,
    extension: true,
    presets: true,
    formatter: true,
    usageTracking: true,
    deactivation: true,
    slackNotifications: true,
  },
];

export function getPlanById(id: number): SubscriptionPlan {
  return subscriptionPlans.find((plan) => plan.id === id) || subscriptionPlans[0];
}

export function getPlanIdByName(name: string | null | undefined): number {
  switch (name) {
    case "Basic":
      return 2;
    case "Premium":
      return 3;
    case "Ultimate":
      return 4;
    default:
      return 1;
  }
}

export function getPaidPlanNameById(id: number): PaidPlanName | null {
  switch (id) {
    case 2:
      return "Basic";
    case 3:
      return "Premium";
    case 4:
      return "Ultimate";
    default:
      return null;
  }
}

export function canUseUsageTracking(
  planOrId: SubscriptionPlan | number | null | undefined,
): boolean {
  const planId = typeof planOrId === "number" ? planOrId : (planOrId?.id ?? 0);
  return planId >= 3;
}

export function canDeactivateGiftCards(
  planOrId: SubscriptionPlan | number | null | undefined,
): boolean {
  const planId = typeof planOrId === "number" ? planOrId : (planOrId?.id ?? 0);
  return planId >= 3;
}

export function canUseSlackNotifications(
  planOrId: SubscriptionPlan | number | null | undefined,
): boolean {
  const planId = typeof planOrId === "number" ? planOrId : (planOrId?.id ?? 0);
  return planId >= 3;
}

export function canDownload(plan: SubscriptionPlan, jobCreatedAt: Date): boolean {
  if (plan.downloadDays === -1) return true;
  const now = new Date();
  const diffMs = now.getTime() - jobCreatedAt.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays <= plan.downloadDays;
}

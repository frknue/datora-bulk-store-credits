import { authenticate } from "../shopify.server";
import {
  canDownload,
  getPlanById,
  getPlanIdByName,
  type SubscriptionPlan,
} from "../lib/subscriptions/plans";
import type { LoaderFunctionArgs } from "react-router";

type AppRequest = LoaderFunctionArgs["request"];
type AdminAuthContext = Awaited<ReturnType<typeof authenticate.admin>>;
type AdminContext = AdminAuthContext["admin"];
type BillingContext = AdminAuthContext["billing"];
type PlanFeatureId =
  | "download-csv"
  | "code-formatter"
  | "send-by-email"
  | "duplicate-jobs"
  | "job-presets"
  | "premium-support"
  | "usage-tracking"
  | "gift-cards";
type PlanLimitId = "maxGiftCards" | "maxStoreCredits" | "jobs" | "downloadDays";

const featureMinimumPlans: Record<PlanFeatureId, SubscriptionPlan["name"]> = {
  "download-csv": "Free",
  "code-formatter": "Basic",
  "send-by-email": "Basic",
  "duplicate-jobs": "Basic",
  "job-presets": "Premium",
  "premium-support": "Premium",
  "usage-tracking": "Premium",
  "gift-cards": "Basic",
};

const planServiceCache = new WeakMap<AppRequest, PlanService>();

export function hasPlanFeature(
  plan: SubscriptionPlan,
  featureId: PlanFeatureId,
): boolean {
  switch (featureId) {
    case "download-csv":
      return true;
    case "code-formatter":
      return plan.formatter;
    case "send-by-email":
      return plan.extension;
    case "duplicate-jobs":
      return plan.duplicate;
    case "job-presets":
      return plan.presets;
    case "premium-support":
      return plan.support;
    case "usage-tracking":
      return plan.id >= 3;
    case "gift-cards":
      return plan.maxGiftCards !== 0;
    default:
      return false;
  }
}

export function getPlanLimit(plan: SubscriptionPlan, limit: PlanLimitId): number {
  return plan[limit];
}

export function canCreateGiftCardsWithPlan(
  plan: SubscriptionPlan,
  totalCreatedThisMonth: number,
  requestedCount = 1,
): boolean {
  return (
    getPlanLimit(plan, "maxGiftCards") === -1 ||
    totalCreatedThisMonth + requestedCount <= getPlanLimit(plan, "maxGiftCards")
  );
}

export function canRunJobsWithPlan(
  plan: SubscriptionPlan,
  activeJobCount: number,
): boolean {
  return activeJobCount < getPlanLimit(plan, "jobs");
}

export function getFeatureMinimumPlan(
  featureId: PlanFeatureId,
): SubscriptionPlan["name"] {
  return featureMinimumPlans[featureId];
}

const isTestShopCache = new Map<string, boolean>();

export async function isShopTest(
  admin: AdminContext,
  shop: string,
): Promise<boolean> {
  const cached = isTestShopCache.get(shop);
  if (cached !== undefined) return cached;

  try {
    const response = await admin.graphql(`#graphql
      query ShopBillingContext {
        shop {
          plan {
            partnerDevelopment
          }
        }
      }
    `);
    const json = (await response.json()) as {
      data?: { shop?: { plan?: { partnerDevelopment?: boolean } } };
    };
    const isTest = Boolean(json.data?.shop?.plan?.partnerDevelopment);
    isTestShopCache.set(shop, isTest);
    return isTest;
  } catch (error) {
    console.error("Failed to read shop.plan, defaulting to non-test:", error);
    return false;
  }
}

const ACTIVE_APP_SUBSCRIPTIONS_QUERY = `#graphql
  query ActiveAppSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
      }
    }
  }
`;

type ActiveSubscriptionsResponse = {
  data?: {
    currentAppInstallation?: {
      activeSubscriptions?: Array<{
        id: string;
        name: string;
        status: string;
        test: boolean;
      }>;
    };
  };
};

// `billing` and `shop` are kept in the signature so the existing callers don't
// have to change. The BFS reviewer's test charge wasn't recognized because
// billing.check filters by isTest — and isTest comes from
// shop.plan.partnerDevelopment, which is false on reviewer stores. Query
// currentAppInstallation.activeSubscriptions directly instead; it returns
// both test and live active subs in one call. The write path (billing.request
// / billing.cancel) is unchanged.
export async function getPlanFromBilling(
  admin: AdminContext,
  _billing: BillingContext,
  shop: string,
): Promise<SubscriptionPlan> {
  try {
    const response = await admin.graphql(ACTIVE_APP_SUBSCRIPTIONS_QUERY);
    const json = (await response.json()) as ActiveSubscriptionsResponse;
    const subscriptions =
      json?.data?.currentAppInstallation?.activeSubscriptions ?? [];

    // Any ACTIVE subscription counts, test or live. Reviewer test charges
    // land here with test=true; real merchant charges land here with
    // test=false. Both are treated identically for plan resolution.
    const activeSubscription = subscriptions.find(
      (subscription) => subscription.status === "ACTIVE",
    );

    return getPlanById(getPlanIdByName(activeSubscription?.name));
  } catch (error) {
    console.error("[plan] failed to fetch subscription plan", { shop, error });
    return getPlanById(1);
  }
}

export async function getCurrentPlan(request: AppRequest): Promise<SubscriptionPlan> {
  return PlanService.getInstance(request).getCurrentPlan();
}

export class PlanService {
  private planCache: SubscriptionPlan | null = null;

  public static getInstance(request: AppRequest): PlanService {
    const cachedService = planServiceCache.get(request);

    if (cachedService) {
      return cachedService;
    }

    const service = new PlanService(request);
    planServiceCache.set(request, service);
    return service;
  }

  private constructor(private readonly request: AppRequest) {}

  public async getCurrentPlan(): Promise<SubscriptionPlan> {
    if (this.planCache) {
      return this.planCache;
    }

    const { admin, billing, session } = await authenticate.admin(this.request);
    this.planCache = await getPlanFromBilling(admin, billing, session.shop);
    return this.planCache;
  }

  public async hasFeature(featureId: PlanFeatureId): Promise<boolean> {
    return hasPlanFeature(await this.getCurrentPlan(), featureId);
  }

  public async getNumericLimit(limit: PlanLimitId): Promise<number> {
    return getPlanLimit(await this.getCurrentPlan(), limit);
  }

  public async hasUnlimitedGiftCards(): Promise<boolean> {
    return (await this.getNumericLimit("maxGiftCards")) === -1;
  }

  public async hasUnlimitedDownloads(): Promise<boolean> {
    return (await this.getNumericLimit("downloadDays")) === -1;
  }

  public async canCreateGiftCards(
    totalCreatedThisMonth: number,
    requestedCount = 1,
  ): Promise<boolean> {
    return canCreateGiftCardsWithPlan(
      await this.getCurrentPlan(),
      totalCreatedThisMonth,
      requestedCount,
    );
  }

  public async canRunMoreJobs(activeJobCount: number): Promise<boolean> {
    return canRunJobsWithPlan(await this.getCurrentPlan(), activeJobCount);
  }

  public async canDownloadJob(jobCreatedAt: Date): Promise<boolean> {
    const currentPlan = await this.getCurrentPlan();
    return canDownload(currentPlan, jobCreatedAt);
  }

  public async canUseCodeFormatter(): Promise<boolean> {
    return this.hasFeature("code-formatter");
  }

  public async canUseEmailDelivery(): Promise<boolean> {
    return this.hasFeature("send-by-email");
  }

  public async canDuplicateJobs(): Promise<boolean> {
    return this.hasFeature("duplicate-jobs");
  }

  public async canUseJobPresets(): Promise<boolean> {
    return this.hasFeature("job-presets");
  }

  public async canAccessPremiumSupport(): Promise<boolean> {
    return this.hasFeature("premium-support");
  }

  public async canUseUsageTracking(): Promise<boolean> {
    return this.hasFeature("usage-tracking");
  }

  public async canAccessGiftCards(): Promise<boolean> {
    return this.hasFeature("gift-cards");
  }

  public getFeatureMinimumPlan(featureId: PlanFeatureId): SubscriptionPlan["name"] {
    return getFeatureMinimumPlan(featureId);
  }
}

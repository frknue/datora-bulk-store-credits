import type { SubscriptionPlan } from "../subscriptions/plans";

export interface AppOutletContext {
  subscriptionPlan: SubscriptionPlan;
  shopCurrency: string | null;
  shopTimezoneOffset: string | null;
  shopMetadataLoaded: boolean;
}

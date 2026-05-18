import { useCallback, useEffect, useRef, useState } from "react";
import { data, useFetcher, useOutletContext } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { isShopTest } from "../services/plan.server";
import { markSubscriptionsPageViewed } from "../lib/services/setup-guide.server";
import {
  getPaidPlanNameById,
  paidPlanNames,
  subscriptionPlans,
  type SubscriptionPlan,
} from "../lib/subscriptions/plans";
import { AppPageFooter } from "../components/app-page-footer";
import type { AppOutletContext } from "../lib/types/app";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

const REAUTH_URL_HEADER = "X-Shopify-API-Request-Failure-Reauthorize-Url";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  // Best-effort: don't block page render if the upsert fails.
  try {
    await markSubscriptionsPageViewed(session.shop);
  } catch (error) {
    console.error("Failed to mark subscriptions page viewed:", error);
  }
  return { shopName: session.shop };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return data({ message: "Method not allowed" }, { status: 405 });
  }

  const { admin, billing, session } = await authenticate.admin(request);
  const isTest = await isShopTest(admin, session.shop);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "upgrade") {
    const rawPlanId = formData.get("planId");
    const planId = Number.parseInt(String(rawPlanId ?? ""), 10);

    if (Number.isNaN(planId) || planId === 1) {
      return data(
        { success: false, message: "Invalid subscription id" },
        { status: 400 },
      );
    }

    const planName = getPaidPlanNameById(planId);

    if (!planName) {
      return data(
        { success: false, message: "Invalid subscription id" },
        { status: 400 },
      );
    }

    await billing.require({
      plans: [planName],
      isTest,
      onFailure: async () =>
        billing.request({
          plan: planName,
          isTest,
        }),
    });

    return data({ success: true });
  }

  if (intent !== "cancel") {
    return data({ success: false, message: "Invalid action" }, { status: 400 });
  }

  try {
    const billingCheck = await billing.check({
      plans: [...paidPlanNames],
      isTest,
    });
    const activeSubscriptions = billingCheck.appSubscriptions.filter(
      (subscription) => subscription.status === "ACTIVE",
    );

    await Promise.all(
      activeSubscriptions.map((subscription) =>
        billing.cancel({
          subscriptionId: subscription.id,
          isTest,
          prorate: true,
        }),
      ),
    );

    return data({ success: true, message: "Subscription cancelled", planId: 1 });
  } catch (error) {
    console.error("Billing cancellation error:", error);
    return data(
      { success: false, message: "Error changing subscription" },
      { status: 500 },
    );
  }
};

const formatMonthlyLimit = (value: number) => {
  if (value === -1) return "Unlimited";
  if (value === 0) return "Not available";
  return value.toLocaleString();
};

const limits: { label: string; getValue: (p: SubscriptionPlan) => string }[] = [
  {
    label: "Max Store Credits",
    getValue: (p) => formatMonthlyLimit(p.maxStoreCredits),
  },
  {
    label: "Max Gift Cards",
    getValue: (p) => formatMonthlyLimit(p.maxGiftCards),
  },
  {
    label: "Running Jobs",
    getValue: (p) => p.jobs.toString(),
  },
  {
    label: "Download Window",
    getValue: (p) => (p.downloadDays === -1 ? "Unlimited" : p.downloadName),
  },
];

const features: { label: string; check: (p: SubscriptionPlan) => boolean }[] = [
  { label: "Store Credit Issuance", check: () => true },
  { label: "Gift Card Creation", check: (p) => p.maxGiftCards !== 0 },
  { label: "Download CSV", check: () => true },
  { label: "Code Formatter", check: (p) => p.formatter },
  { label: "Send by Email", check: (p) => p.extension },
  { label: "Duplicate Jobs", check: (p) => p.duplicate },
  { label: "Job Presets", check: (p) => p.presets },
  { label: "Usage Tracking", check: (p) => p.usageTracking },
  { label: "Gift Card Deactivation", check: (p) => p.deactivation },
  { label: "Slack Notifications", check: (p) => p.slackNotifications },
  { label: "Premium Support", check: (p) => p.support },
];

const rowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px 0",
  borderTop: "1px solid var(--p-color-border-secondary)",
};

function PlanCard({
  plan,
  isCurrent,
  currentPrice,
  loading,
  onSelect,
}: {
  plan: SubscriptionPlan;
  isCurrent: boolean;
  currentPrice: number;
  loading: boolean;
  onSelect: () => void;
}) {
  const getButtonLabel = () => {
    if (isCurrent) return "Current plan";
    if (plan.price > currentPrice) return `Upgrade to ${plan.name}`;
    return `Downgrade to ${plan.name}`;
  };

  return (
    <s-box padding="large" borderWidth="base" borderRadius="base" background="base">
      <s-stack direction="block" gap="large">
        {/* Header */}
        <s-stack direction="inline" gap="small" alignItems="center">
          <span style={{ fontSize: "1.25rem", fontWeight: 600 }}>{plan.name}</span>
          {isCurrent && <s-badge tone="neutral">Current Plan</s-badge>}
        </s-stack>

        {/* Price */}
        <s-stack direction="inline" gap="small" alignItems="baseline">
          <s-heading>${plan.price === 0 ? "0" : plan.price.toFixed(2)}</s-heading>
          <s-text color="subdued">/month</s-text>
        </s-stack>

        {/* Limits */}
        <div>
          <s-box padding-block-end="small">
            <s-text type="strong">Limits</s-text>
          </s-box>
          {limits.map((limit) => (
            <div key={limit.label} style={rowStyle}>
              <s-text>{limit.label}</s-text>
              <s-text>{limit.getValue(plan)}</s-text>
            </div>
          ))}
        </div>

        {/* Features */}
        <div>
          <s-box padding-block-end="small">
            <s-text type="strong">Features</s-text>
          </s-box>
          {features.map((feature) => {
            const included = feature.check(plan);
            return (
              <div key={feature.label} style={rowStyle}>
                <s-text>{feature.label}</s-text>
                <s-text type="strong">{included ? "YES" : "NO"}</s-text>
              </div>
            );
          })}
        </div>

        {/* Action Button */}
        <s-button
          variant="primary"
          disabled={isCurrent || loading || undefined}
          onClick={onSelect}
          {...{ inlineSize: "fill" }}
          {...(loading && !isCurrent ? { loading: true } : {})}
        >
          {getButtonLabel()}
        </s-button>
      </s-stack>
    </s-box>
  );
}

export default function Subscriptions() {
  const shopify = useAppBridge();
  const { subscriptionPlan } = useOutletContext<AppOutletContext>();

  const [isChangingPlan, setIsChangingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const cancelPlanFetcher = useFetcher<typeof action>();
  const loading = isChangingPlan || cancelPlanFetcher.state !== "idle";
  const cancelModalRef = useRef<
    HTMLElement & { showOverlay(): void; hideOverlay(): void }
  >(null);

  useEffect(() => {
    const response = cancelPlanFetcher.data;

    if (cancelPlanFetcher.state !== "idle" || !response || !("success" in response)) {
      return;
    }

    if (response.success) {
      setPlanError(null);
      shopify.toast.show("Subscription cancelled");
      window.location.reload();
      return;
    }

    setPlanError(
      "Couldn't cancel your subscription. Please try again or contact support.",
    );
  }, [cancelPlanFetcher.data, cancelPlanFetcher.state, shopify]);

  const handlePlanChange = useCallback(
    async (plan: SubscriptionPlan) => {
      if (plan.id === subscriptionPlan.id) return;

      if (plan.id === 1) {
        cancelModalRef.current?.showOverlay();
        return;
      }

      setIsChangingPlan(true);
      setPlanError(null);
      try {
        const idToken = await shopify.idToken();
        const response = await fetch("/app/subscriptions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          },
          body: new URLSearchParams({
            intent: "upgrade",
            planId: String(plan.id),
          }),
        });

        const redirectUrl =
          response.headers.get(REAUTH_URL_HEADER) || response.headers.get("Location");

        if (response.status === 401 && redirectUrl) {
          window.open(redirectUrl, "_top");
          return;
        }

        if (response.ok) {
          window.location.reload();
          return;
        }

        setPlanError(
          `Couldn't change to the ${plan.name} plan. Please try again.`,
        );
      } catch {
        setPlanError(
          `Couldn't change to the ${plan.name} plan. Check your connection and try again.`,
        );
      } finally {
        setIsChangingPlan(false);
      }
    },
    [shopify, subscriptionPlan.id],
  );

  const handleCancelSubscription = useCallback(async () => {
    cancelModalRef.current?.hideOverlay();
    cancelPlanFetcher.submit({ intent: "cancel" }, { method: "POST" });
  }, [cancelPlanFetcher]);

  return (
    <s-page heading="Subscription Plans" inlineSize="large">
      <s-link slot="breadcrumb-actions" href="/app">
        Dashboard
      </s-link>

      <s-stack direction="block" gap="base">
        {planError && <s-banner tone="critical">{planError}</s-banner>}

        <s-grid
          gridTemplateColumns="@container (inline-size <= 900px) 1fr, 1fr 1fr 1fr 1fr"
          gap="base"
        >
          {subscriptionPlans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              isCurrent={plan.id === subscriptionPlan.id}
              currentPrice={subscriptionPlan.price}
              loading={loading}
              onSelect={() => handlePlanChange(plan)}
            />
          ))}
        </s-grid>

        <AppPageFooter />
      </s-stack>

      <s-modal
        id="cancel-subscription-modal"
        ref={cancelModalRef as never}
        heading="Cancel Subscription"
        onHide={() => {}}
      >
        <s-paragraph>
          Are you sure you want to cancel your subscription and switch to the Free plan?
          You will lose access to premium features.
        </s-paragraph>
        <s-button
          slot="secondary-actions"
          commandFor="cancel-subscription-modal"
          command="--hide"
        >
          Cancel
        </s-button>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          onClick={handleCancelSubscription}
        >
          Confirm downgrade
        </s-button>
      </s-modal>
    </s-page>
  );
}

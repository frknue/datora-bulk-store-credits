import imgFeature from "../images/bulk_gift_cards_feature_2.svg";
import imgFeedback from "../images/bulk_gift_cards_feedback.svg";
import { formatNumber, getCurrencySymbol } from "../lib/utils/formatting";
import type { SubscriptionPlan } from "../lib/subscriptions/plans";

export { DashboardJobsTable } from "../features/dashboard/components/dashboard-jobs-table";

interface DashboardStatCardsProps {
  totalGiftCardsAllTime: number;
  totalValueGenerated: number;
  totalGiftCardsThisMonth: number;
  runningCount: number;
  pendingCount: number;
  successRate: number;
  shopCurrency: string;
}

function getSuccessBadgeTone(rate: number): "success" | "warning" | "critical" {
  if (rate >= 80) return "success";
  if (rate >= 50) return "warning";
  return "critical";
}

export function DashboardStatCards({
  totalGiftCardsAllTime,
  totalValueGenerated,
  totalGiftCardsThisMonth,
  successRate,
  shopCurrency,
}: DashboardStatCardsProps) {
  const currencyLabel = getCurrencySymbol(shopCurrency);

  return (
    <s-section padding="base">
      <s-grid
        gridTemplateColumns="@container (inline-size <= 600px) 1fr, 1fr auto 1fr auto 1fr auto 1fr"
        gap="small"
      >
        <s-box paddingBlock="small-400" paddingInline="small-100">
          <s-grid gap="small-300">
            <s-heading>Total Gift Cards</s-heading>
            <s-text>{formatNumber(totalGiftCardsAllTime, 0)}</s-text>
          </s-grid>
        </s-box>

        <s-divider direction="block" />

        <s-box paddingBlock="small-400" paddingInline="small-100">
          <s-grid gap="small-300">
            <s-heading>Total Value</s-heading>
            <s-text>{`${formatNumber(totalValueGenerated)}${currencyLabel}`}</s-text>
          </s-grid>
        </s-box>

        <s-divider direction="block" />

        <s-box paddingBlock="small-400" paddingInline="small-100">
          <s-grid gap="small-300">
            <s-heading>This Month</s-heading>
            <s-text>{formatNumber(totalGiftCardsThisMonth, 0)}</s-text>
          </s-grid>
        </s-box>

        <s-divider direction="block" />

        <s-box paddingBlock="small-400" paddingInline="small-100">
          <s-grid gap="small-300">
            <s-heading>Success Rate</s-heading>
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text>{`${successRate}%`}</s-text>
              <s-badge tone={getSuccessBadgeTone(successRate)}>
                {successRate >= 80
                  ? "Good"
                  : successRate >= 50
                    ? "Needs attention"
                    : "Failing"}
              </s-badge>
            </s-stack>
          </s-grid>
        </s-box>
      </s-grid>
    </s-section>
  );
}

interface DashboardUsageSectionProps {
  totalGiftCardsThisMonth: number;
  planName: string;
  planMaxAmount: number;
  isUnlimited: boolean;
}

interface DashboardRunningJobsBannerProps {
  runningCount: number;
  pendingCount: number;
}

interface DashboardEmptyStateProps {
  onCreateJob: () => void;
}

interface DashboardCalloutCardsProps {
  subscriptionPlan: SubscriptionPlan;
  showFeatureCard: boolean;
  showContactCard: boolean;
  onDismissFeatureCard: () => void;
  onDismissContactCard: () => void;
  contactHref: string;
}

function DashboardUsageProgressBar({
  percent,
  tone,
}: {
  percent: number;
  tone: "base" | "strong";
}) {
  const fillColor =
    tone === "strong"
      ? "var(--p-color-bg-fill-critical, #d72c0d)"
      : "var(--p-color-text, #303030)";

  return (
    <div style={{ position: "relative", width: "100%", height: "10px", flexShrink: 0 }}>
      <s-box
        background="subdued"
        borderRadius="base"
        inlineSize="100%"
        blockSize="10px"
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          height: "10px",
          width: `${percent}%`,
          backgroundColor: fillColor,
          borderRadius: "4px",
        }}
      />
    </div>
  );
}

export function DashboardUsageSection({
  totalGiftCardsThisMonth,
  planName,
  planMaxAmount,
  isUnlimited,
}: DashboardUsageSectionProps) {
  const usagePercent = isUnlimited
    ? 0
    : Math.min(100, Math.round((totalGiftCardsThisMonth / planMaxAmount) * 100));
  const remaining = isUnlimited
    ? "unlimited"
    : formatNumber(Math.max(0, planMaxAmount - totalGiftCardsThisMonth), 0);
  const isAtLimit = !isUnlimited && totalGiftCardsThisMonth >= planMaxAmount;
  const progressTone = isAtLimit || usagePercent >= 80 ? "strong" : "base";

  return (
    <s-box
      border="base"
      borderColor="subdued"
      borderRadius="large-100"
      padding="base"
      background="base"
    >
      <s-stack direction="inline" gap="base" alignItems="center">
        <s-box>
          <s-text>
            <strong>{planName.toUpperCase()}</strong>
          </s-text>
        </s-box>

        <div style={{ flex: 1, minWidth: 0 }}>
          <s-stack direction="block" gap="small-100">
            <DashboardUsageProgressBar percent={usagePercent} tone={progressTone} />
            <s-stack direction="inline" justifyContent="space-between" gap="base">
              <s-text>
                <strong>Used:</strong> {formatNumber(totalGiftCardsThisMonth, 0)}
                {isUnlimited ? "" : ` / ${formatNumber(planMaxAmount, 0)}`}
              </s-text>
              <s-text>
                <strong>Available:</strong> {remaining}
              </s-text>
            </s-stack>
          </s-stack>
        </div>

        {isAtLimit ? (
          <s-button variant="secondary" href="/app/subscriptions">
            Upgrade plan
          </s-button>
        ) : null}
      </s-stack>
    </s-box>
  );
}

function DashboardCalloutCard({
  title,
  description,
  buttonLabel,
  buttonHref,
  onButtonClick,
  imageSrc,
  onDismiss,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  buttonHref?: string;
  onButtonClick?: () => void;
  imageSrc: string;
  onDismiss?: () => void;
}) {
  return (
    <s-box
      border="base"
      borderColor="subdued"
      borderRadius="large-100"
      padding="base"
      background="base"
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
          height: "100%",
          position: "relative",
        }}
      >
        {onDismiss && (
          <div
            style={{ position: "absolute", top: "-0.5rem", right: "-0.5rem", zIndex: 1 }}
          >
            <s-button
              variant="tertiary"
              icon="x-circle"
              accessibilityLabel="Dismiss"
              onClick={onDismiss}
            />
          </div>
        )}

        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <s-stack direction="block" gap="base">
              <s-heading>{title}</s-heading>
              <s-paragraph>{description}</s-paragraph>
            </s-stack>
          </div>

          <div
            style={{
              width: "5.5rem",
              maxWidth: "30%",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
            }}
          >
            <img
              src={imageSrc}
              alt=""
              aria-hidden="true"
              style={{ width: "100%", height: "auto" }}
            />
          </div>
        </div>

        <div style={{ marginTop: "auto" }}>
          <s-button
            variant="secondary"
            {...(buttonHref ? { href: buttonHref } : {})}
            {...(onButtonClick ? { onClick: onButtonClick } : {})}
          >
            {buttonLabel}
          </s-button>
        </div>
      </div>
    </s-box>
  );
}

export function DashboardCalloutCards({
  subscriptionPlan,
  showFeatureCard,
  showContactCard = true,
  onDismissFeatureCard,
  onDismissContactCard,
  contactHref,
}: DashboardCalloutCardsProps) {
  const featureButtonHref = subscriptionPlan.extension
    ? "/app/faq?q=9"
    : "/app/subscriptions";
  const featureButtonLabel = subscriptionPlan.extension
    ? "How it works (Q9)"
    : "Upgrade plan";

  return (
    <s-grid
      gridTemplateColumns="@container (inline-size <= 600px) 1fr, 1fr 1fr"
      gap="base"
    >
      {showContactCard && (
        <DashboardCalloutCard
          title="Need help or miss a feature?"
          description="If you have any questions or missing a feature in our app, feel free to contact us. Your feedback will drive our improvements."
          buttonLabel="Get in touch with us"
          buttonHref={contactHref}
          imageSrc={imgFeedback}
          onDismiss={onDismissContactCard}
        />
      )}

      {showFeatureCard && (
        <DashboardCalloutCard
          title="New: bulk store credit"
          description="Issue store credit to one customer or a whole Shopify segment in one go. Pick a currency, set an optional expiry, and send now or schedule for later."
          buttonLabel={featureButtonLabel}
          buttonHref={featureButtonHref}
          imageSrc={imgFeature}
          onDismiss={onDismissFeatureCard}
        />
      )}
    </s-grid>
  );
}

export function DashboardFooterHelp({ contactHref = "/app/contact" }: { contactHref?: string }) {
  return (
    <s-box padding="base">
      <s-grid justifyItems="center">
        <s-text>
          If you need support, we are{" "}
          <s-link href={contactHref}>here</s-link>{" "}
          for you.
        </s-text>
      </s-grid>
    </s-box>
  );
}

export function DashboardRunningJobsBanner({
  runningCount,
  pendingCount,
}: DashboardRunningJobsBannerProps) {
  if (runningCount === 0 && pendingCount === 0) {
    return null;
  }

  return (
    <s-banner tone="info">
      <s-stack direction="inline" gap="small">
        <s-spinner size="base" accessibilityLabel="Loading jobs" />
        <s-text>
          {runningCount > 0 && `${runningCount} job(s) running`}
          {runningCount > 0 && pendingCount > 0 && ", "}
          {pendingCount > 0 && `${pendingCount} job(s) pending`}
        </s-text>
      </s-stack>
    </s-banner>
  );
}

export function DashboardEmptyState({ onCreateJob }: DashboardEmptyStateProps) {
  return (
    <s-section accessibilityLabel="Empty state section">
      <s-grid gap="base" justifyItems="center" paddingBlock="large-400">
        <s-box maxInlineSize="200px" maxBlockSize="200px">
          <s-image aspectRatio="1/0.5" src={imgFeature} alt="Gift cards illustration" />
        </s-box>
        <s-grid justifyItems="center" maxInlineSize="450px" gap="base">
          <s-stack alignItems="center">
            <s-heading>Start creating gift cards</s-heading>
            <s-paragraph>
              Create and manage bulk gift cards for your store. Set values, quantities,
              and deliver them to your customers.
            </s-paragraph>
          </s-stack>
          <s-button variant="primary" onClick={onCreateJob}>
            Create gift cards
          </s-button>
        </s-grid>
      </s-grid>
    </s-section>
  );
}

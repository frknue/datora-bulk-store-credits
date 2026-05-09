import { useCallback } from "react";
import {
  Link,
  useFetcher,
  useLoaderData,
  useNavigate,
  useOutletContext,
} from "react-router";
import { authenticate } from "../shopify.server";
import { loadOverviewData } from "../lib/services/overview.server";
import {
  dismissFeatureCard,
  dismissContactCard,
} from "../lib/services/dashboard.server";
import {
  DashboardCalloutCards,
  DashboardFooterHelp,
  DashboardUsageSection,
} from "../components/dashboard-sections";
import { AppPageFooter } from "../components/app-page-footer";
import {
  formatDateString,
  formatNumber,
  getCurrencySymbol,
} from "../lib/utils/formatting";
import {
  getStoreCreditJobBadgeLabel,
  getStoreCreditJobBadgeTone,
} from "../lib/utils/store-credit-status";
import type { AppOutletContext } from "../lib/types/app";
import type {
  OverviewRecentFeature,
  OverviewRecentJob,
} from "../lib/services/overview.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return loadOverviewData(session.shop);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("action");

  if (actionType === "dismiss_feature_card") {
    await dismissFeatureCard(session.shop);
    return { success: true };
  }

  if (actionType === "dismiss_contact_card") {
    await dismissContactCard(session.shop);
    return { success: true };
  }

  return { success: false };
};

const GIFT_CARD_TONE: Record<
  string,
  "success" | "info" | "warning" | "caution" | "critical" | "neutral"
> = {
  completed: "success",
  running: "info",
  pending: "info",
  scheduled: "caution",
  failed: "critical",
  cancelled: "neutral",
  deactivated: "warning",
};

function getJobBadgeTone(feature: OverviewRecentFeature, status: string) {
  return feature === "store_credit"
    ? getStoreCreditJobBadgeTone(status)
    : (GIFT_CARD_TONE[status] ?? "warning");
}

function getJobBadgeLabel(feature: OverviewRecentFeature, status: string) {
  return feature === "store_credit"
    ? getStoreCreditJobBadgeLabel(status)
    : status;
}

function OverviewStatCards({
  totalIssuedAllTime,
  giftAllTime,
  creditAllTime,
  activeJobs,
  planName,
}: {
  totalIssuedAllTime: number;
  giftAllTime: number;
  creditAllTime: number;
  activeJobs: number;
  planName: string;
}) {
  return (
    <s-section padding="base">
      <s-grid
        gridTemplateColumns="@container (inline-size <= 400px) 1fr, 1fr auto 1fr auto 1fr auto 1fr"
        gap="small"
      >
        <s-box paddingBlock="small-400" paddingInline="small-100">
          <s-grid gap="small-300">
            <s-heading>Total Issued</s-heading>
            <s-text>{formatNumber(totalIssuedAllTime, 0)}</s-text>
          </s-grid>
        </s-box>
        <s-divider direction="block" />
        <s-box paddingBlock="small-400" paddingInline="small-100">
          <s-grid gap="small-300">
            <s-heading>Gift Cards</s-heading>
            <s-text>{formatNumber(giftAllTime, 0)}</s-text>
          </s-grid>
        </s-box>
        <s-divider direction="block" />
        <s-box paddingBlock="small-400" paddingInline="small-100">
          <s-grid gap="small-300">
            <s-heading>Store Credits</s-heading>
            <s-text>{formatNumber(creditAllTime, 0)}</s-text>
          </s-grid>
        </s-box>
        <s-divider direction="block" />
        <s-box paddingBlock="small-400" paddingInline="small-100">
          <s-grid gap="small-300">
            <s-heading>Active Jobs</s-heading>
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text>{formatNumber(activeJobs, 0)}</s-text>
              <s-badge tone="neutral">{planName}</s-badge>
            </s-stack>
          </s-grid>
        </s-box>
      </s-grid>
    </s-section>
  );
}

function QuickActionCard({
  title,
  description,
  buttonLabel,
  onClick,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  onClick: () => void;
}) {
  return (
    <s-box
      border="base"
      borderColor="subdued"
      borderRadius="large-100"
      padding="base"
      background="base"
      blockSize="100%"
    >
      <s-stack
        direction="block"
        gap="base"
        justifyContent="space-between"
        blockSize="100%"
      >
        <s-stack direction="block" gap="base">
          <s-heading>{title}</s-heading>
          <s-paragraph>{description}</s-paragraph>
        </s-stack>
        <s-stack direction="inline">
          <s-button variant="primary" onClick={onClick}>
            {buttonLabel}
          </s-button>
        </s-stack>
      </s-stack>
    </s-box>
  );
}

function RecentActivityRow({ job }: { job: OverviewRecentJob }) {
  const isCredit = job.feature === "store_credit";
  const featureLabel = isCredit ? "Store Credit" : "Gift Card";
  const detailHref = isCredit
    ? `/app/store-credit/${job.id}`
    : `/app/gift-cards/${job.id}`;
  const currencySymbol = job.currency ? getCurrencySymbol(job.currency) : "";
  const amountLabel = `${formatNumber(job.amount)}${currencySymbol} × ${formatNumber(job.count, 0)}`;

  return (
    <s-table-row>
      <s-table-cell>
        <s-badge tone={isCredit ? "info" : "success"}>{featureLabel}</s-badge>
      </s-table-cell>
      <s-table-cell>
        <Link
          to={detailHref}
          style={{
            color: "inherit",
            textDecoration: "none",
            fontWeight: 700,
            fontFamily: "monospace",
          }}
        >
          #{job.id.slice(0, 8).toUpperCase()}
        </Link>
      </s-table-cell>
      <s-table-cell>
        <s-badge tone={getJobBadgeTone(job.feature, job.status)}>
          {getJobBadgeLabel(job.feature, job.status)}
        </s-badge>
      </s-table-cell>
      <s-table-cell>
        <s-text>{amountLabel}</s-text>
      </s-table-cell>
      <s-table-cell>
        <s-text>{formatDateString(job.createdAt)}</s-text>
      </s-table-cell>
    </s-table-row>
  );
}

export default function Overview() {
  const {
    giftMonthlyUsed,
    giftAllTime,
    giftRunning,
    giftPending,
    creditMonthlyUsed,
    creditAllTime,
    creditRunning,
    creditPending,
    recent,
    showCard,
    showContactCard,
  } = useLoaderData<typeof loader>();
  const { subscriptionPlan } = useOutletContext<AppOutletContext>();
  const navigate = useNavigate();
  const fetcher = useFetcher();

  const maxGiftCardsCap = subscriptionPlan.maxGiftCards;
  const maxStoreCreditsCap = subscriptionPlan.maxStoreCredits;
  const giftCardsUnlimited = maxGiftCardsCap === -1;
  const storeCreditsUnlimited = maxStoreCreditsCap === -1;
  const totalIssuedAllTime = giftAllTime + creditAllTime;
  const activeJobs = giftRunning + giftPending + creditRunning + creditPending;

  const handleDismissFeatureCard = useCallback(() => {
    fetcher.submit({ action: "dismiss_feature_card" }, { method: "post" });
  }, [fetcher]);

  const handleDismissContactCard = useCallback(() => {
    fetcher.submit({ action: "dismiss_contact_card" }, { method: "post" });
  }, [fetcher]);

  return (
    <s-page heading="Overview" inlineSize="large">
      <s-stack direction="block" gap="base">
        <OverviewStatCards
          totalIssuedAllTime={totalIssuedAllTime}
          giftAllTime={giftAllTime}
          creditAllTime={creditAllTime}
          activeJobs={activeJobs}
          planName={subscriptionPlan.name}
        />

        <s-grid gridTemplateColumns="1fr 1fr" gap="base">
          <QuickActionCard
            title="Create gift cards"
            description="Generate bulk gift cards with custom codes, values, and optional scheduled email delivery."
            buttonLabel="Create gift cards"
            onClick={() => navigate("/app/gift-cards/create")}
          />
          <QuickActionCard
            title="Issue store credit"
            description="Credit one or many customers with store credit. Pick a currency, set an expiry, and send now or later."
            buttonLabel="Issue store credit"
            onClick={() => navigate("/app/store-credit/create")}
          />
        </s-grid>

        <s-grid gridTemplateColumns="1fr 1fr" gap="base">
          <s-stack direction="block" gap="small">
            <s-stack
              direction="inline"
              justifyContent="space-between"
              alignItems="center"
            >
              <s-heading>Gift Cards — This Month</s-heading>
              <s-button
                variant="tertiary"
                onClick={() => navigate("/app/gift-cards")}
              >
                Manage
              </s-button>
            </s-stack>
            <DashboardUsageSection
              totalGiftCardsThisMonth={giftMonthlyUsed}
              planName={subscriptionPlan.name}
              planMaxAmount={maxGiftCardsCap}
              isUnlimited={giftCardsUnlimited}
            />
          </s-stack>

          <s-stack direction="block" gap="small">
            <s-stack
              direction="inline"
              justifyContent="space-between"
              alignItems="center"
            >
              <s-heading>Store Credits — This Month</s-heading>
              <s-button
                variant="tertiary"
                onClick={() => navigate("/app/store-credit")}
              >
                Manage
              </s-button>
            </s-stack>
            <DashboardUsageSection
              totalGiftCardsThisMonth={creditMonthlyUsed}
              planName={subscriptionPlan.name}
              planMaxAmount={maxStoreCreditsCap}
              isUnlimited={storeCreditsUnlimited}
            />
          </s-stack>
        </s-grid>

        <s-section padding="none">
          <s-box padding="base">
            <s-heading>Recent Activity</s-heading>
          </s-box>
          {recent.length === 0 ? (
            <s-box padding="base">
              <s-paragraph>
                No jobs yet. Start by creating gift cards or issuing store
                credit.
              </s-paragraph>
            </s-box>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="inline">Feature</s-table-header>
                <s-table-header>Job</s-table-header>
                <s-table-header listSlot="inline">Status</s-table-header>
                <s-table-header listSlot="labeled">Amount</s-table-header>
                <s-table-header listSlot="labeled">Created</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {recent.map((job) => (
                  <RecentActivityRow key={`${job.feature}:${job.id}`} job={job} />
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-section>

        <DashboardCalloutCards
          subscriptionPlan={subscriptionPlan}
          showFeatureCard={showCard}
          showContactCard={showContactCard}
          onDismissFeatureCard={handleDismissFeatureCard}
          onDismissContactCard={handleDismissContactCard}
          contactHref="/app/contact"
        />

        <DashboardFooterHelp contactHref="/app/contact" />

        <AppPageFooter />
      </s-stack>
    </s-page>
  );
}

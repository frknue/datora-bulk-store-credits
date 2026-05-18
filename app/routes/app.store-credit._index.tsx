import {
  Link,
  useFetcher,
  useLoaderData,
  useNavigate,
  useSearchParams,
  useOutletContext,
} from "react-router";
import { useCallback } from "react";
import { authenticate } from "../shopify.server";
import { loadStoreCreditDashboardData } from "../lib/services/store-credit-dashboard.server";
import { dismissFeatureCard, dismissContactCard } from "../lib/services/dashboard.server";
import { useJobProgressPolling } from "../lib/hooks/use-job-progress-polling";
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
import emptyStateIllustration from "../images/bulk_gift_cards_feature_2.svg";
import type { AppOutletContext } from "../lib/types/app";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  return loadStoreCreditDashboardData(session.shop, page);
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

function getSuccessBadgeTone(rate: number): "success" | "warning" | "critical" {
  if (rate >= 80) return "success";
  if (rate >= 50) return "warning";
  return "critical";
}

function StoreCreditStatCards({
  totalRecipientsAllTime,
  totalRecipientsThisMonth,
  succeededRecipients,
  successRate,
}: {
  totalRecipientsAllTime: number;
  totalRecipientsThisMonth: number;
  succeededRecipients: number;
  successRate: number;
}) {
  return (
    <s-section padding="base">
      <s-grid
        gridTemplateColumns="@container (inline-size <= 600px) 1fr, 1fr auto 1fr auto 1fr auto 1fr"
        gap="small"
      >
        <s-box paddingBlock="small-400" paddingInline="small-100">
          <s-grid gap="small-300">
            <s-heading>Total Recipients</s-heading>
            <s-text>{formatNumber(totalRecipientsAllTime, 0)}</s-text>
          </s-grid>
        </s-box>

        <s-divider direction="block" />

        <s-box paddingBlock="small-400" paddingInline="small-100">
          <s-grid gap="small-300">
            <s-heading>This Month</s-heading>
            <s-text>{formatNumber(totalRecipientsThisMonth, 0)}</s-text>
          </s-grid>
        </s-box>

        <s-divider direction="block" />

        <s-box paddingBlock="small-400" paddingInline="small-100">
          <s-grid gap="small-300">
            <s-heading>Succeeded</s-heading>
            <s-text>{formatNumber(succeededRecipients, 0)}</s-text>
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

function StoreCreditProgressBar({ percent }: { percent: number }) {
  return (
    <div
      style={{
        height: "6px",
        borderRadius: "3px",
        backgroundColor: "var(--p-color-bg-surface-secondary)",
        overflow: "hidden",
        marginTop: "4px",
      }}
    >
      <div
        style={{
          width: `${Math.min(100, Math.max(0, percent))}%`,
          height: "100%",
          backgroundColor: "var(--p-color-bg-fill-info)",
          borderRadius: "3px",
          transition: "width 0.3s ease",
        }}
      />
    </div>
  );
}

export default function StoreCreditIndex() {
  const {
    jobs,
    totalJobs,
    page,
    totalPages,
    storeCreditRecipientsAllTime,
    storeCreditRecipientsThisMonth,
    succeededRecipients,
    successRate,
    showCard,
    showContactCard,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const [searchParams, setSearchParams] = useSearchParams();
  const { subscriptionPlan } = useOutletContext<AppOutletContext>();

  const handleDismissFeatureCard = useCallback(() => {
    fetcher.submit({ action: "dismiss_feature_card" }, { method: "post" });
  }, [fetcher]);

  const handleDismissContactCard = useCallback(() => {
    fetcher.submit({ action: "dismiss_contact_card" }, { method: "post" });
  }, [fetcher]);

  const planMaxAmount = subscriptionPlan.maxStoreCredits;
  const isUnlimited = planMaxAmount === -1;
  const isAtLimit =
    !isUnlimited && storeCreditRecipientsThisMonth >= planMaxAmount;

  const activeJobIds = jobs
    .filter((j) => j.status === "pending" || j.status === "running")
    .map((j) => j.id);
  const progressMap = useJobProgressPolling(activeJobIds, {
    endpoint: "/api/store-credits/progress",
    onTerminalStatus: () => navigate(".", { replace: true }),
  });

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(newPage));
    setSearchParams(params);
  };

  return (
    <s-page heading="Store Credits" inlineSize="large">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => navigate("/app/store-credit/create")}
      >
        Issue store credit
      </s-button>

      <s-stack direction="block" gap="base">
        {isAtLimit && (
          <s-banner tone="warning">
            You&apos;ve reached your monthly limit of {formatNumber(planMaxAmount, 0)}{" "}
            issues on the {subscriptionPlan.name} plan.{" "}
            <s-link href="/app/subscriptions">Upgrade your plan</s-link> to issue more.
          </s-banner>
        )}

        {totalJobs > 0 && (
          <StoreCreditStatCards
            totalRecipientsAllTime={storeCreditRecipientsAllTime}
            totalRecipientsThisMonth={storeCreditRecipientsThisMonth}
            succeededRecipients={succeededRecipients}
            successRate={successRate}
          />
        )}

        {jobs.length === 0 ? (
          <s-section accessibilityLabel="Empty state section">
            <s-grid gap="base" justifyItems="center" paddingBlock="large-400">
              <s-box maxInlineSize="200px" maxBlockSize="200px">
                <s-image
                  aspectRatio="1/0.5"
                  src={emptyStateIllustration}
                  alt="Illustration of bulk issuance"
                />
              </s-box>
              <s-grid justifyItems="center" maxInlineSize="450px" gap="base">
                <s-stack alignItems="center">
                  <s-heading>Start issuing store credit</s-heading>
                  <s-paragraph>
                    Issue Shopify store credit in bulk to a list of customers.
                    Set an amount, pick a currency, and deliver it in a few
                    clicks.
                  </s-paragraph>
                </s-stack>
                <s-button-group>
                  <s-button
                    slot="primary-action"
                    variant="primary"
                    aria-label="Issue store credit"
                    onClick={() => navigate("/app/store-credit/create")}
                  >
                    Issue store credit
                  </s-button>
                </s-button-group>
              </s-grid>
            </s-grid>
          </s-section>
        ) : (
          <s-section padding="none">
            <s-table
              paginate
              hasPreviousPage={page > 1 || undefined}
              hasNextPage={page < totalPages || undefined}
              onPreviousPage={() => handlePageChange(page - 1)}
              onNextPage={() => handlePageChange(page + 1)}
            >
              <s-table-header-row>
                <s-table-header>Job ID</s-table-header>
                <s-table-header listSlot="inline">Status</s-table-header>
                <s-table-header listSlot="labeled" format="numeric">
                  Recipients
                </s-table-header>
                <s-table-header listSlot="labeled" format="numeric">
                  Amount
                </s-table-header>
                <s-table-header listSlot="labeled" format="numeric">
                  Total
                </s-table-header>
                <s-table-header listSlot="labeled">Created at</s-table-header>
                <s-table-header listSlot="labeled">Scheduled</s-table-header>
                <s-table-header listSlot="inline">Failed</s-table-header>
              </s-table-header-row>

              <s-table-body>
                {jobs.map((job) => {
                  const progress = progressMap[job.id];
                  const liveStatus =
                    progress?.status && progress.status !== "unknown"
                      ? progress.status
                      : job.status;
                  const done = progress?.done ?? job.done + job.failed;
                  const total = progress?.total ?? job.count;
                  const isActive =
                    liveStatus === "running" || liveStatus === "pending";
                  const showBar = isActive && total > 0;
                  const percent =
                    showBar && total > 0
                      ? Math.round((done / total) * 100)
                      : 0;
                  const amountValue = Number(job.amount);
                  const totalValue = amountValue * job.count;
                  const currencySymbol = getCurrencySymbol(job.currency);
                  const quantityLabel = isActive
                    ? `${formatNumber(done, 0)}/${formatNumber(total, 0)}`
                    : formatNumber(job.count, 0);

                  return (
                    <s-table-row key={job.id}>
                      <s-table-cell>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                          }}
                        >
                          <Link
                            to={`/app/store-credit/${job.id}`}
                            style={{
                              color: "inherit",
                              textDecoration: "none",
                              fontWeight: 700,
                              whiteSpace: "nowrap",
                              fontFamily: "monospace",
                              display: "inline-block",
                              width: "9ch",
                            }}
                          >
                            #{job.id.slice(0, 8).toUpperCase()}
                          </Link>
                          {job.note && (
                            <>
                              <s-tooltip id={`sc-job-${job.id}-note-tooltip`}>
                                <s-text>{job.note}</s-text>
                              </s-tooltip>
                              <s-button
                                variant="tertiary"
                                icon="note"
                                interestFor={`sc-job-${job.id}-note-tooltip`}
                                accessibilityLabel={job.note}
                              />
                            </>
                          )}
                        </div>
                      </s-table-cell>

                      <s-table-cell>
                        <s-badge tone={getStoreCreditJobBadgeTone(liveStatus)}>
                          {getStoreCreditJobBadgeLabel(liveStatus)}
                        </s-badge>
                      </s-table-cell>

                      <s-table-cell>
                        <div style={{ position: "relative" }}>
                          <s-text>{quantityLabel}</s-text>
                          {showBar && (
                            <div
                              style={{
                                position: "absolute",
                                top: "100%",
                                left: 0,
                                right: 0,
                              }}
                            >
                              <StoreCreditProgressBar percent={percent} />
                            </div>
                          )}
                        </div>
                      </s-table-cell>

                      <s-table-cell>
                        {formatNumber(amountValue)}
                        {currencySymbol}
                      </s-table-cell>
                      <s-table-cell>
                        {formatNumber(totalValue)}
                        {currencySymbol}
                      </s-table-cell>
                      <s-table-cell>
                        {formatDateString(job.createdAt)}
                      </s-table-cell>
                      <s-table-cell>
                        {job.scheduledTimestamp
                          ? formatDateString(job.scheduledTimestamp)
                          : "—"}
                      </s-table-cell>
                      <s-table-cell>
                        {job.failed > 0 ? (
                          <s-badge tone="critical">{job.failed}</s-badge>
                        ) : (
                          <s-text>—</s-text>
                        )}
                      </s-table-cell>
                    </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>
          </s-section>
        )}

        <DashboardUsageSection
          totalGiftCardsThisMonth={storeCreditRecipientsThisMonth}
          planName={subscriptionPlan.name}
          planMaxAmount={planMaxAmount}
          isUnlimited={isUnlimited}
        />

        <DashboardCalloutCards
          subscriptionPlan={subscriptionPlan}
          showFeatureCard={showCard}
          onDismissFeatureCard={handleDismissFeatureCard}
          showContactCard={showContactCard}
          onDismissContactCard={handleDismissContactCard}
          contactHref="/app/contact"
        />

        <DashboardFooterHelp contactHref="/app/contact" />

        <AppPageFooter />
      </s-stack>
    </s-page>
  );
}

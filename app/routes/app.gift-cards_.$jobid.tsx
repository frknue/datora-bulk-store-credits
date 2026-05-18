import {
  useLoaderData,
  useNavigate,
  useSearchParams,
  useOutletContext,
  data,
} from "react-router";
import { useCallback, useState } from "react";
import {
  JobErrorBanner,
  JobSuccessBanner,
  JobGiftCardListSection,
  JobRunningProgressBanner,
  JobSidebarSection,
  JobUsageTrackingSection,
} from "../components/job-details-sections";
import { AppPageFooter } from "../components/app-page-footer";
import { authenticate } from "../shopify.server";
import { useJobLifecycleActions } from "../lib/hooks/use-job-lifecycle-actions";
import { useJobProgressPolling } from "../lib/hooks/use-job-progress-polling";
import { useJobUsageTracking } from "../lib/hooks/use-job-usage-tracking";
import {
  loadJobDetailsPageData,
  handleJobDetailAction,
} from "../lib/services/job-details.server";
import {
  canDeactivateGiftCards,
  canDownload,
  canUseUsageTracking,
} from "../lib/subscriptions/plans";
import { buildDuplicateJobSearchParams } from "../lib/utils/jobs";
import { getPlanFromBilling } from "../services/plan.server";
import type { AppOutletContext } from "../lib/types/app";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";

const CARDS_PER_PAGE = 25;
const USAGE_RECORDS_PER_PAGE = 25;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const jobId = params.jobid;

  if (!jobId) {
    throw data({ message: "Job ID is required" }, { status: 400 });
  }

  const jobDetails = await loadJobDetailsPageData({
    jobId,
    shopName: session.shop,
  });

  if (!jobDetails) {
    throw data({ message: "Job not found" }, { status: 404 });
  }

  return jobDetails;
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const jobId = params.jobid;
  const formData = await request.formData();
  const intent = formData.get("intent");
  const subscriptionPlan = await getPlanFromBilling(admin, billing, session.shop);

  if (!jobId) return data({ message: "Job ID is required" }, { status: 400 });

  const result = await handleJobDetailAction({
    admin,
    currentPlanId: subscriptionPlan.id,
    intent,
    jobId,
    shopName: session.shop,
  });

  if (result.status) {
    return data(result.body, { status: result.status });
  }

  return result.body;
};

export default function JobDetails() {
  const {
    job,
    giftCards,
    totalCards,
    prevJobId,
    nextJobId,
    shopHandle,
    usageRefreshRemainingMs,
    activeDeactivationJobId,
  } = useLoaderData<typeof loader>();
  const { subscriptionPlan, shopCurrency } = useOutletContext<AppOutletContext>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeAction, cancelJob, retryJob, deactivateJob, resumeJob } =
    useJobLifecycleActions({
      onSuccess: () => navigate(".", { replace: true }),
    });
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);

  const cardPage = Math.max(1, parseInt(searchParams.get("cardPage") || "1", 10));
  const usagePage = Math.max(1, parseInt(searchParams.get("usagePage") || "1", 10));
  const totalCardPages = Math.ceil(totalCards / CARDS_PER_PAGE);
  const paginatedCards = giftCards.slice(
    (cardPage - 1) * CARDS_PER_PAGE,
    cardPage * CARDS_PER_PAGE,
  );

  const isRunning = job.status === "running" || job.status === "pending";
  const progressMap = useJobProgressPolling(isRunning ? [job.id] : [], {
    onTerminalStatus: () => navigate(".", { replace: true }),
  });
  const progress = progressMap[job.id] ?? null;

  // Poll deactivation progress when a deactivation job is active.
  const deactivationProgressMap = useJobProgressPolling(
    activeDeactivationJobId ? [activeDeactivationJobId] : [],
    { onTerminalStatus: () => navigate(".", { replace: true }) },
  );
  const deactivationProgress = activeDeactivationJobId
    ? (deactivationProgressMap[activeDeactivationJobId] ?? null)
    : null;
  const isDeactivationRunning = !!activeDeactivationJobId;

  const currency = job.giftCardCurrency || shopCurrency || "USD";
  const hasMailed = !!job.customerIds;
  const canDl = canDownload(subscriptionPlan, new Date(job.createdAt));

  const canRetry = job.status === "failed";
  const canCancel = ["scheduled", "pending", "running"].includes(job.status);
  const canDuplicate = subscriptionPlan.duplicate && job.status === "completed";
  const isDeactivated = !!job.deactivatedAt;
  const canDeactivate =
    canDeactivateGiftCards(subscriptionPlan) &&
    !isDeactivated &&
    !isDeactivationRunning &&
    (job.status === "completed" ||
      (job.status === "cancelled" && totalCards > 0));
  const canResume =
    job.status === "cancelled" && !isDeactivated && !isDeactivationRunning;
  const isRetrying = activeAction?.jobId === job.id && activeAction.intent === "retry";
  const isCancelling = activeAction?.jobId === job.id && activeAction.intent === "cancel";
  const isDeactivating =
    activeAction?.jobId === job.id && activeAction.intent === "deactivate";
  const isResuming =
    activeAction?.jobId === job.id && activeAction.intent === "resume";

  const canViewUsage =
    canUseUsageTracking(subscriptionPlan) && job.status === "completed";
  const activeView = canViewUsage ? searchParams.get("view") || "details" : "details";

  const handleViewChange = useCallback(
    (view: string) => {
      const params = new URLSearchParams(searchParams);
      if (view === "details") {
        params.delete("view");
      } else {
        params.set("view", view);
      }
      setSearchParams(params, { preventScrollReset: true });
    },
    [searchParams, setSearchParams],
  );

  const handleDownload = useCallback(() => {
    navigate(`/app/gift-cards/${job.id}/download`);
  }, [navigate, job.id]);

  const handleDuplicate = useCallback(() => {
    navigate(`/app/gift-cards/create?${buildDuplicateJobSearchParams(job)}`);
  }, [job, navigate]);

  const handleRetry = useCallback(() => {
    void retryJob(job.id);
  }, [job.id, retryJob]);

  const handleCancel = useCallback(() => {
    void cancelJob(job.id);
  }, [cancelJob, job.id]);

  const handleResume = useCallback(() => {
    void resumeJob(job.id);
  }, [resumeJob, job.id]);

  const handleDeactivate = useCallback(() => {
    setShowDeactivateConfirm(true);
  }, []);

  const handleDeactivateConfirm = useCallback(() => {
    setShowDeactivateConfirm(false);
    void deactivateJob(job.id);
  }, [deactivateJob, job.id]);

  const handleDeactivateCancel = useCallback(() => {
    setShowDeactivateConfirm(false);
  }, []);

  const handleCardPageChange = useCallback(
    (newPage: number) => {
      const params = new URLSearchParams(searchParams);
      params.set("cardPage", String(newPage));
      setSearchParams(params, { preventScrollReset: true });
    },
    [searchParams, setSearchParams],
  );

  const handleUsagePageChange = useCallback(
    (newPage: number) => {
      const params = new URLSearchParams(searchParams);
      params.set("usagePage", String(newPage));
      setSearchParams(params, { preventScrollReset: true });
    },
    [searchParams, setSearchParams],
  );

  const {
    usageMetrics,
    paginatedUsageRecords,
    usagePreviewCount,
    usageRecordCount,
    normalizedUsagePage,
    totalUsagePages,
    usageError,
    usageLastRefreshedAt,
    usageCooldownRemaining,
    usageLoading,
    usageRefreshProgress,
    refreshUsage,
    exportUsage,
  } = useJobUsageTracking({
    jobId: job.id,
    canViewUsage,
    usagePage,
    usageRecordsPerPage: USAGE_RECORDS_PER_PAGE,
    initialUsageLastRefreshedAt: job.usageLastRefreshedAt,
    initialUsageRefreshRemainingMs: usageRefreshRemainingMs,
  });

  const done = progress?.done ?? job.done;
  const total = progress?.total ?? job.count;
  const progressPercent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <s-page heading={`Job ${job.id.slice(0, 8)}...`} inlineSize="base">
      <s-link slot="breadcrumb-actions" href="/app/gift-cards">
        Gift Cards
      </s-link>

      {canCancel && (
        <s-button
          slot="secondary-actions"
          onClick={handleCancel}
          loading={isCancelling || undefined}
        >
          Cancel
        </s-button>
      )}
      {canResume && (
        <s-button
          slot="secondary-actions"
          onClick={handleResume}
          loading={isResuming || undefined}
          disabled={isRetrying || isCancelling || isDeactivating || undefined}
        >
          Resume
        </s-button>
      )}
      {canRetry && (
        <s-button
          slot="secondary-actions"
          onClick={handleRetry}
          loading={isRetrying || undefined}
        >
          Retry
        </s-button>
      )}
      {canDuplicate && (
        <s-button
          slot="secondary-actions"
          onClick={handleDuplicate}
          disabled={isRetrying || isCancelling || isResuming || undefined}
        >
          Duplicate
        </s-button>
      )}
      {canDeactivate && (
        <s-button
          slot="secondary-actions"
          onClick={handleDeactivate}
          loading={isDeactivating || undefined}
          disabled={isRetrying || isCancelling || isResuming || undefined}
        >
          Deactivate
        </s-button>
      )}
      {job.status === "completed" && canDl && (
        <s-button
          slot="secondary-actions"
          onClick={handleDownload}
          disabled={
            isRetrying || isCancelling || isDeactivating || isResuming || undefined
          }
        >
          Download
        </s-button>
      )}
      <s-button
        slot="secondary-actions"
        icon="chevron-left"
        variant="tertiary"
        accessibilityLabel="Previous job"
        disabled={!prevJobId || undefined}
        onClick={() => prevJobId && navigate(`/app/gift-cards/${prevJobId}`)}
      />
      <s-button
        slot="secondary-actions"
        icon="chevron-right"
        variant="tertiary"
        accessibilityLabel="Next job"
        disabled={!nextJobId || undefined}
        onClick={() => nextJobId && navigate(`/app/gift-cards/${nextJobId}`)}
      />

      <s-stack direction="block" gap="base">
        {isRunning && (
          <JobRunningProgressBanner
            done={done}
            total={total}
            progressPercent={progressPercent}
          />
        )}

        {isDeactivationRunning && (
          <s-banner tone="warning">
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-spinner size="base" />
              <s-text>
                Deactivating gift cards...
                {deactivationProgress
                  ? ` ${deactivationProgress.done}/${deactivationProgress.total}`
                  : ""}
              </s-text>
            </s-stack>
          </s-banner>
        )}

        {job.status === "failed" && job.errorMessage && (
          <JobErrorBanner errorMessage={job.errorMessage} />
        )}

        {job.status === "completed" && <JobSuccessBanner total={total} />}

        {canViewUsage && (
          <s-section>
            <s-stack direction="inline" gap="small">
              <s-clickable-chip
                color={activeView === "details" ? "strong" : "base"}
                onClick={() => handleViewChange("details")}
                accessibilityLabel="Show job details"
              >
                Details
              </s-clickable-chip>
              <s-clickable-chip
                color={activeView === "usage" ? "strong" : "base"}
                onClick={() => handleViewChange("usage")}
                accessibilityLabel="Show usage tracking"
              >
                Usage Tracking
              </s-clickable-chip>
            </s-stack>
          </s-section>
        )}

        {activeView === "details" && (
          <s-grid
            gridTemplateColumns="@container (inline-size <= 600px) 1fr, 2fr 1fr"
            gap="base"
          >
            <s-grid-item>
              <JobGiftCardListSection
                shopHandle={shopHandle}
                totalCards={totalCards}
                paginatedCards={paginatedCards}
                cardPage={cardPage}
                totalCardPages={totalCardPages}
                cardsPerPage={CARDS_PER_PAGE}
                onCardPageChange={handleCardPageChange}
              />
            </s-grid-item>
            <s-grid-item>
              <JobSidebarSection
                job={job}
                currency={currency}
                hasMailed={hasMailed}
                displayStatus={
                  isDeactivated ? "deactivated" : progress?.status || job.status
                }
              />
            </s-grid-item>
          </s-grid>
        )}

        {activeView === "usage" && canViewUsage && (
          <JobUsageTrackingSection
            currency={currency}
            shopHandle={shopHandle}
            usageMetrics={usageMetrics}
            usageRecords={paginatedUsageRecords}
            usagePreviewCount={usagePreviewCount}
            usageRecordCount={usageRecordCount}
            usagePage={normalizedUsagePage}
            totalUsagePages={totalUsagePages}
            usageRecordsPerPage={USAGE_RECORDS_PER_PAGE}
            usageError={usageError}
            usageLastRefreshedAt={usageLastRefreshedAt}
            usageCooldownRemaining={usageCooldownRemaining}
            usageLoading={usageLoading}
            usageRefreshProgress={usageRefreshProgress}
            onUsagePageChange={handleUsagePageChange}
            onExportUsage={exportUsage}
            onRefreshUsage={refreshUsage}
          />
        )}

        <AppPageFooter />
      </s-stack>

      {showDeactivateConfirm && (
        <s-modal
          id="deactivate-confirm-modal"
          heading="Deactivate all gift cards?"
          ref={(el: HTMLElement | null) => {
            if (el && "showOverlay" in el) {
              setTimeout(
                () => (el as HTMLElement & { showOverlay: () => void }).showOverlay(),
                0,
              );
            }
          }}
        >
          <s-stack direction="block" gap="base">
            <s-text>
              This will permanently deactivate all {totalCards} gift card(s) from this
              job. Deactivated gift cards cannot be re-enabled and customers will no
              longer be able to use them.
            </s-text>
            <s-text>
              <strong>This action cannot be undone.</strong>
            </s-text>
          </s-stack>
          <s-button
            slot="secondary-actions"
            commandFor="deactivate-confirm-modal"
            command="--hide"
            onClick={handleDeactivateCancel}
          >
            Cancel
          </s-button>
          <s-button
            slot="primary-action"
            variant="primary"
            tone="critical"
            onClick={handleDeactivateConfirm}
          >
            Deactivate gift cards
          </s-button>
        </s-modal>
      )}
    </s-page>
  );
}

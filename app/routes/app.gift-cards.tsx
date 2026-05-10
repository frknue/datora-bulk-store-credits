import {
  useLoaderData,
  useFetcher,
  useNavigate,
  useSearchParams,
  useOutletContext,
} from "react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  DashboardCalloutCards,
  DashboardEmptyState,
  DashboardFooterHelp,
  DashboardJobsTable,
  DashboardStatCards,
  DashboardUsageSection,
} from "../components/dashboard-sections";
import { AppPageFooter } from "../components/app-page-footer";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { getPlanFromBilling } from "../services/plan.server";
import { useJobLifecycleActions } from "../lib/hooks/use-job-lifecycle-actions";
import { useJobProgressPolling } from "../lib/hooks/use-job-progress-polling";
import {
  loadDashboardPageData,
  dismissFeatureCard,
  dismissContactCard,
} from "../lib/services/dashboard.server";
import { canDownload } from "../lib/subscriptions/plans";
import { formatNumber } from "../lib/utils/formatting";
import { buildDuplicateJobSearchParams } from "../lib/utils/jobs";
import type { AppOutletContext } from "../lib/types/app";
import type { DashboardJob } from "../lib/types/jobs";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const plan = await getPlanFromBilling(billing, session.shop);
  if (plan.maxGiftCards === 0) {
    throw redirect("/app/subscriptions");
  }
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  return loadDashboardPageData(session.shop, page);
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

export default function Dashboard() {
  const {
    jobs,
    totalJobs,
    page,
    totalPages,
    totalGiftCardsThisMonth,
    totalGiftCardsAllTime,
    totalValueGenerated,
    runningCount,
    pendingCount,
    successRate,
    completedJobCount,
    showCard,
    showContactCard,
    deactivatingJobMap,
  } = useLoaderData<typeof loader>();

  const { subscriptionPlan, shopCurrency } = useOutletContext<AppOutletContext>();
  const displayCurrency = shopCurrency || "USD";
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeAction, cancelJob, retryJob, deactivateJob, resumeJob } =
    useJobLifecycleActions({
      onSuccess: () => navigate(".", { replace: true }),
    });

  const runningJobs = jobs.filter(
    (j) => j.status === "running" || j.status === "pending",
  );
  const runningJobIds = runningJobs.map((j) => j.id);

  // Also poll progress for active deactivation jobs.
  const deactivationJobIds = Object.values(deactivatingJobMap);
  const allPollingIds = [...runningJobIds, ...deactivationJobIds];
  const jobProgress = useJobProgressPolling(allPollingIds, {
    onTerminalStatus: () => navigate(".", { replace: true }),
  });

  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());

  const eligibleJobIds = useMemo(
    () =>
      jobs
        .filter(
          (j) =>
            j.status === "completed" &&
            canDownload(subscriptionPlan, new Date(j.createdAt)),
        )
        .map((j) => j.id),
    [jobs, subscriptionPlan],
  );

  const handleToggleJobSelection = useCallback((jobId: string) => {
    setSelectedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      return next;
    });
  }, []);

  const handleToggleAllSelection = useCallback(() => {
    setSelectedJobIds((prev) => {
      const allSelected = eligibleJobIds.every((id) => prev.has(id));
      if (allSelected) {
        return new Set();
      }
      return new Set(eligibleJobIds);
    });
  }, [eligibleJobIds]);

  const handleBatchDownload = useCallback(() => {
    if (selectedJobIds.size === 0) return;
    const ids = Array.from(selectedJobIds).join(",");
    navigate(`/app/gift-cards/download?ids=${ids}`);
  }, [selectedJobIds, navigate]);

  const handleClearSelection = useCallback(() => {
    setSelectedJobIds(new Set());
  }, []);

  const handlePageChange = useCallback(
    (newPage: number) => {
      setSelectedJobIds(new Set());
      const params = new URLSearchParams(searchParams);
      params.set("page", String(newPage));
      setSearchParams(params);
    },
    [searchParams, setSearchParams],
  );

  const handleDuplicate = useCallback(
    (job: DashboardJob) => {
      navigate(`/app/gift-cards/create?${buildDuplicateJobSearchParams(job)}`);
    },
    [navigate],
  );

  const handleRetry = useCallback(
    (jobId: string) => {
      void retryJob(jobId);
    },
    [retryJob],
  );

  const handleResume = useCallback(
    (jobId: string) => {
      void resumeJob(jobId);
    },
    [resumeJob],
  );

  const handleCancel = useCallback(
    (jobId: string) => {
      void cancelJob(jobId);
    },
    [cancelJob],
  );

  const handleDownload = useCallback(
    (jobId: string) => {
      navigate(`/app/gift-cards/${jobId}/download`);
    },
    [navigate],
  );

  const handleDeactivate = useCallback(
    (jobId: string) => {
      void deactivateJob(jobId);
    },
    [deactivateJob],
  );

  const handleDismissFeatureCard = useCallback(() => {
    fetcher.submit({ action: "dismiss_feature_card" }, { method: "post" });
  }, [fetcher]);

  const handleDismissContactCard = useCallback(() => {
    fetcher.submit({ action: "dismiss_contact_card" }, { method: "post" });
  }, [fetcher]);

  useEffect(() => {
    if (completedJobCount >= 5 && !sessionStorage.getItem("reviewShown")) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (shopify as any).reviews
        ?.request()
        .then((result: { success: boolean }) => {
          if (result.success) {
            sessionStorage.setItem("reviewShown", "1");
          }
        })
        .catch(() => {});
    }
  }, [completedJobCount, shopify]);

  const planMaxAmount = subscriptionPlan.maxGiftCards;
  const isUnlimited = planMaxAmount === -1;
  const isAtLimit = !isUnlimited && totalGiftCardsThisMonth >= planMaxAmount;

  return (
    <s-page heading="Gift Card Jobs" inlineSize="large">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => navigate("/app/gift-cards/create")}
      >
        Create gift cards
      </s-button>

      <s-stack direction="block" gap="base">
        {/* Plan limit warning */}
        {isAtLimit && (
          <s-banner tone="warning">
            You&apos;ve reached your monthly limit of {formatNumber(planMaxAmount, 0)}{" "}
            gift cards on the {subscriptionPlan.name} plan.{" "}
            <s-link href="/app/subscriptions">Upgrade your plan</s-link> to create more.
          </s-banner>
        )}

        {totalJobs > 0 && (
          <DashboardStatCards
            totalGiftCardsAllTime={totalGiftCardsAllTime}
            totalValueGenerated={totalValueGenerated}
            totalGiftCardsThisMonth={totalGiftCardsThisMonth}
            runningCount={runningCount}
            pendingCount={pendingCount}
            successRate={successRate}
            shopCurrency={displayCurrency}
          />
        )}

        {totalJobs === 0 ? (
          <DashboardEmptyState onCreateJob={() => navigate("/app/gift-cards/create")} />
        ) : (
          <DashboardJobsTable
            jobs={jobs}
            page={page}
            totalPages={totalPages}
            totalJobs={totalJobs}
            subscriptionPlan={subscriptionPlan}
            shopCurrency={displayCurrency}
            jobProgress={jobProgress}
            activeJobAction={activeAction}
            deactivatingJobMap={deactivatingJobMap}
            selectedJobIds={selectedJobIds}
            onToggleJobSelection={handleToggleJobSelection}
            onToggleAllSelection={handleToggleAllSelection}
            onBatchDownload={handleBatchDownload}
            onClearSelection={handleClearSelection}
            onPreviousPage={() => handlePageChange(page - 1)}
            onNextPage={() => handlePageChange(page + 1)}
            onCancel={handleCancel}
            onDeactivate={handleDeactivate}
            onDownload={handleDownload}
            onDuplicate={handleDuplicate}
            onRetry={handleRetry}
            onResume={handleResume}
          />
        )}

        <DashboardUsageSection
          totalGiftCardsThisMonth={totalGiftCardsThisMonth}
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

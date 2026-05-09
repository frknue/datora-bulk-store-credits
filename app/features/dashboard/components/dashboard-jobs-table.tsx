import { Link } from "react-router";
import {
  canDeactivateGiftCards,
  canDownload,
  type SubscriptionPlan,
} from "../../../lib/subscriptions/plans";
import {
  formatDateString,
  formatNumber,
  getCurrencySymbol,
} from "../../../lib/utils/formatting";
import type { JobProgress } from "../../../lib/types";
import type { DashboardJob } from "../../../lib/types/jobs";
import type { JobLifecycleIntent } from "../../../lib/hooks/use-job-lifecycle-actions";

interface DashboardJobsTableProps {
  jobs: DashboardJob[];
  page: number;
  totalPages: number;
  totalJobs: number;
  subscriptionPlan: SubscriptionPlan;
  shopCurrency: string;
  jobProgress: Record<string, JobProgress>;
  activeJobAction?: {
    jobId: string;
    intent: JobLifecycleIntent;
  } | null;
  deactivatingJobMap: Record<string, string>;
  selectedJobIds: Set<string>;
  onToggleJobSelection: (jobId: string) => void;
  onToggleAllSelection: () => void;
  onBatchDownload: () => void;
  onClearSelection: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onCancel: (jobId: string) => void;
  onDeactivate: (jobId: string) => void;
  onDownload: (jobId: string, subscriptionPlanId?: number | null) => void;
  onDuplicate: (job: DashboardJob) => void;
  onRetry: (jobId: string) => void;
  onResume: (jobId: string) => void;
}

function renderDashboardStatusBadge(status: string, label?: string) {
  const toneMap: Record<
    string,
    "success" | "info" | "warning" | "critical" | "caution" | "neutral"
  > = {
    completed: "success",
    deactivated: "warning",
    deactivating: "caution",
    running: "info",
    pending: "info",
    scheduled: "caution",
    failed: "critical",
    cancelled: "neutral",
  };

  return <s-badge tone={toneMap[status] || "warning"}>{label || status}</s-badge>;
}

function JobProgressBar({ percent }: { percent: number }) {
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

function DashboardRowActions({
  job,
  subscriptionPlan,
  canDownloadJob,
  isActiveActionRow,
  isJobDeactivating,
  isRetrying,
  isCancelling,
  isDeactivating,
  isResuming,
  onCancel,
  onDeactivate,
  onDownload,
  onDuplicate,
  onRetry,
  onResume,
}: {
  job: DashboardJob;
  subscriptionPlan: SubscriptionPlan;
  canDownloadJob: boolean;
  isActiveActionRow: boolean;
  isJobDeactivating: boolean;
  isRetrying: boolean;
  isCancelling: boolean;
  isDeactivating: boolean;
  isResuming: boolean;
  onCancel: (jobId: string) => void;
  onDeactivate: (jobId: string) => void;
  onDownload: (jobId: string, subscriptionPlanId?: number | null) => void;
  onDuplicate: (job: DashboardJob) => void;
  onRetry: (jobId: string) => void;
  onResume: (jobId: string) => void;
}) {
  const completedCount = Math.max(job.done || 0, 0);
  const shouldContinueFailedJob = job.status === "failed" && completedCount > 0;
  const cancelTooltipId = `job-${job.id}-cancel-tooltip`;
  const retryTooltipId = `job-${job.id}-${shouldContinueFailedJob ? "continue" : "retry"}-tooltip`;
  const downloadTooltipId = `job-${job.id}-download-tooltip`;
  const duplicateTooltipId = `job-${job.id}-duplicate-tooltip`;
  const deactivateTooltipId = `job-${job.id}-deactivate-tooltip`;
  const canDeactivate =
    canDeactivateGiftCards(subscriptionPlan) &&
    job.status === "completed" &&
    !job.deactivatedAt;
  const canDeactivateCancelled =
    canDeactivateGiftCards(subscriptionPlan) &&
    !job.deactivatedAt &&
    !isJobDeactivating &&
    completedCount > 0;
  const canResumeCancelled = !job.deactivatedAt && !isJobDeactivating;
  const resumeTooltipId = `job-${job.id}-resume-tooltip`;

  if (["scheduled", "pending", "running"].includes(job.status)) {
    return (
      <>
        <s-tooltip id={cancelTooltipId}>
          <s-text>Cancel job</s-text>
        </s-tooltip>
        <s-button
          variant="secondary"
          icon="x"
          interestFor={cancelTooltipId}
          accessibilityLabel="Cancel job"
          onClick={() => onCancel(job.id)}
          disabled={isActiveActionRow || undefined}
          loading={isCancelling || undefined}
        />
      </>
    );
  }

  if (job.status === "failed") {
    return (
      <>
        <s-tooltip id={retryTooltipId}>
          <s-text>{shouldContinueFailedJob ? "Continue job" : "Retry job"}</s-text>
        </s-tooltip>
        <s-button
          variant="secondary"
          interestFor={retryTooltipId}
          accessibilityLabel={shouldContinueFailedJob ? "Continue job" : "Retry job"}
          onClick={() => onRetry(job.id)}
          disabled={isActiveActionRow || undefined}
          loading={isRetrying || undefined}
          icon={shouldContinueFailedJob ? "play" : "redo"}
        />
      </>
    );
  }

  if (job.status === "completed") {
    return (
      <s-stack direction="inline" gap="small" alignItems="center">
        {canDownloadJob && (
          <>
            <s-tooltip id={downloadTooltipId}>
              <s-text>Download job</s-text>
            </s-tooltip>
            <s-button
              variant="secondary"
              icon="page-down"
              interestFor={downloadTooltipId}
              accessibilityLabel="Download job"
              onClick={() => onDownload(job.id, job.subscriptionPlanId)}
              disabled={isActiveActionRow || undefined}
            />
          </>
        )}
        {subscriptionPlan.duplicate && (
          <>
            <s-tooltip id={duplicateTooltipId}>
              <s-text>Duplicate job</s-text>
            </s-tooltip>
            <s-button
              variant="secondary"
              icon="duplicate"
              interestFor={duplicateTooltipId}
              accessibilityLabel="Duplicate job"
              onClick={() => onDuplicate(job)}
              disabled={isActiveActionRow || undefined}
            />
          </>
        )}
        {canDeactivate && (
          <>
            <s-tooltip id={deactivateTooltipId}>
              <s-text>Deactivate gift cards</s-text>
            </s-tooltip>
            <s-button
              variant="secondary"
              icon="disabled"
              interestFor={deactivateTooltipId}
              accessibilityLabel="Deactivate gift cards"
              onClick={() => onDeactivate(job.id)}
              disabled={isActiveActionRow || undefined}
              loading={isDeactivating || undefined}
            />
          </>
        )}
      </s-stack>
    );
  }

  if (job.status === "cancelled" && canResumeCancelled) {
    return (
      <s-stack direction="inline" gap="small" alignItems="center">
        <s-tooltip id={resumeTooltipId}>
          <s-text>Resume job</s-text>
        </s-tooltip>
        <s-button
          variant="secondary"
          icon="play"
          interestFor={resumeTooltipId}
          accessibilityLabel="Resume job"
          onClick={() => onResume(job.id)}
          disabled={isActiveActionRow || undefined}
          loading={isResuming || undefined}
        />
        {canDeactivateCancelled && (
          <>
            <s-tooltip id={deactivateTooltipId}>
              <s-text>Deactivate gift cards</s-text>
            </s-tooltip>
            <s-button
              variant="secondary"
              icon="disabled"
              interestFor={deactivateTooltipId}
              accessibilityLabel="Deactivate gift cards"
              onClick={() => onDeactivate(job.id)}
              disabled={isActiveActionRow || undefined}
              loading={isDeactivating || undefined}
            />
          </>
        )}
      </s-stack>
    );
  }

  return <s-text>—</s-text>;
}

function DashboardJobRow({
  job,
  subscriptionPlan,
  shopCurrency,
  progress,
  activeJobAction,
  isJobDeactivating,
  deactivationProgress: _deactivationProgress,
  isSelected,
  isSelectable,
  hasSelectableJobs,
  onToggleSelection,
  onCancel,
  onDeactivate,
  onDownload,
  onDuplicate,
  onRetry,
  onResume,
}: {
  job: DashboardJob;
  subscriptionPlan: SubscriptionPlan;
  shopCurrency: string;
  progress?: JobProgress;
  activeJobAction?: {
    jobId: string;
    intent: JobLifecycleIntent;
  } | null;
  isJobDeactivating: boolean;
  deactivationProgress?: JobProgress;
  isSelected: boolean;
  isSelectable: boolean;
  hasSelectableJobs: boolean;
  onToggleSelection: () => void;
  onCancel: (jobId: string) => void;
  onDeactivate: (jobId: string) => void;
  onDownload: (jobId: string, subscriptionPlanId?: number | null) => void;
  onDuplicate: (job: DashboardJob) => void;
  onRetry: (jobId: string) => void;
  onResume: (jobId: string) => void;
}) {
  const jobTotal = job.count * job.value;
  const currencyLabel = getCurrencySymbol(job.giftCardCurrency || shopCurrency);
  const hasMailed = Boolean(job.customerIds);
  const canDownloadJob = canDownload(subscriptionPlan, new Date(job.createdAt));
  const baseStatus =
    progress?.status && progress.status !== "unknown" ? progress.status : job.status;
  const displayStatus = isJobDeactivating
    ? "deactivating"
    : job.deactivatedAt
      ? "deactivated"
      : baseStatus;
  const isActiveActionRow = activeJobAction?.jobId === job.id;
  const isRetrying = isActiveActionRow && activeJobAction?.intent === "retry";
  const isCancelling = isActiveActionRow && activeJobAction?.intent === "cancel";
  const isDeactivating = isActiveActionRow && activeJobAction?.intent === "deactivate";
  const isResuming = isActiveActionRow && activeJobAction?.intent === "resume";
  const isActiveJob = ["running", "pending"].includes(displayStatus);
  const showProgress = isActiveJob && progress;
  const progressPercent =
    showProgress && (progress.total ?? job.count) > 0
      ? Math.round(((progress.done ?? 0) / (progress.total ?? job.count)) * 100)
      : 0;
  const quantityLabel =
    (job.status === "failed" && progress?.done) || showProgress
      ? `${formatNumber(progress?.done ?? 0, 0)}/${formatNumber(progress?.total ?? job.count, 0)}`
      : formatNumber(job.count, 0);

  return (
    <s-table-row key={job.id}>
      <s-table-cell>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {isSelectable ? (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggleSelection}
              aria-label={`Select job ${job.id.slice(0, 8).toUpperCase()}`}
              style={{
                width: "16px",
                height: "16px",
                cursor: "pointer",
                accentColor: "var(--p-color-bg-fill-brand)",
              }}
            />
          ) : hasSelectableJobs ? (
            <input
              type="checkbox"
              disabled
              style={{
                width: "16px",
                height: "16px",
                visibility: "hidden",
              }}
            />
          ) : null}
          <Link
            to={`/app/gift-cards/${job.id}`}
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
              <s-tooltip id={`job-${job.id}-note-tooltip`}>
                <s-text>{job.note}</s-text>
              </s-tooltip>
              <s-button
                variant="tertiary"
                icon="note"
                interestFor={`job-${job.id}-note-tooltip`}
                accessibilityLabel={job.note}
              />
            </>
          )}
        </div>
      </s-table-cell>

      <s-table-cell>{renderDashboardStatusBadge(displayStatus)}</s-table-cell>
      <s-table-cell>
        <div style={{ position: "relative" }}>
          <s-text>{quantityLabel}</s-text>
          {showProgress ? (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
              }}
            >
              <JobProgressBar percent={progressPercent} />
            </div>
          ) : null}
        </div>
      </s-table-cell>
      <s-table-cell>{formatNumber(job.value) + currencyLabel}</s-table-cell>
      <s-table-cell>{formatNumber(jobTotal) + currencyLabel}</s-table-cell>
      <s-table-cell>{formatDateString(job.createdAt as unknown as string)}</s-table-cell>
      <s-table-cell>{job.expireDate || "Never"}</s-table-cell>
      <s-table-cell>
        {hasMailed ? (
          renderDashboardStatusBadge(
            job.status === "completed"
              ? "completed"
              : job.status === "failed"
                ? "failed"
                : "pending",
            job.status === "completed" ? "completed" : job.status,
          )
        ) : (
          <s-text>—</s-text>
        )}
      </s-table-cell>
      <s-table-cell>
        <DashboardRowActions
          job={job}
          subscriptionPlan={subscriptionPlan}
          canDownloadJob={canDownloadJob}
          isActiveActionRow={Boolean(isActiveActionRow)}
          isJobDeactivating={isJobDeactivating}
          isRetrying={Boolean(isRetrying)}
          isCancelling={Boolean(isCancelling)}
          isDeactivating={Boolean(isDeactivating)}
          isResuming={Boolean(isResuming)}
          onCancel={onCancel}
          onDeactivate={onDeactivate}
          onDownload={onDownload}
          onDuplicate={onDuplicate}
          onRetry={onRetry}
          onResume={onResume}
        />
      </s-table-cell>
    </s-table-row>
  );
}

function SelectionActionBar({
  selectedCount,
  onDownload,
  onClearSelection,
}: {
  selectedCount: number;
  onDownload: () => void;
  onClearSelection: () => void;
}) {
  if (selectedCount === 0) return null;

  return (
    <div
      style={{
        backgroundColor: "var(--p-color-bg-surface)",
        borderBottom: "1px solid var(--p-color-border-subdued)",
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
      }}
    >
      <s-text>
        {selectedCount} job{selectedCount !== 1 ? "s" : ""} selected
      </s-text>
      <s-stack direction="inline" gap="small">
        <s-button variant="tertiary" onClick={onClearSelection}>
          Clear selection
        </s-button>
        <s-button variant="primary" icon="page-down" onClick={onDownload}>
          Download selected
        </s-button>
      </s-stack>
    </div>
  );
}

export function DashboardJobsTable({
  jobs,
  page,
  totalPages,
  totalJobs: _totalJobs,
  subscriptionPlan,
  shopCurrency,
  jobProgress,
  activeJobAction,
  deactivatingJobMap,
  selectedJobIds,
  onToggleJobSelection,
  onToggleAllSelection,
  onBatchDownload,
  onClearSelection,
  onPreviousPage,
  onNextPage,
  onCancel,
  onDeactivate,
  onDownload,
  onDuplicate,
  onRetry,
  onResume,
}: DashboardJobsTableProps) {
  const eligibleJobs = jobs.filter(
    (j) =>
      j.status === "completed" &&
      canDownload(subscriptionPlan, new Date(j.createdAt)),
  );
  const allEligibleSelected =
    eligibleJobs.length > 0 &&
    eligibleJobs.every((j) => selectedJobIds.has(j.id));
  const someSelected = selectedJobIds.size > 0;

  return (
    <s-section padding="none">
      <SelectionActionBar
        selectedCount={selectedJobIds.size}
        onDownload={onBatchDownload}
        onClearSelection={onClearSelection}
      />
      <s-table
        paginate
        hasPreviousPage={page > 1 || undefined}
        hasNextPage={page < totalPages || undefined}
        onPreviousPage={onPreviousPage}
        onNextPage={onNextPage}
      >
        <s-table-header-row>
          <s-table-header listSlot="secondary">
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {eligibleJobs.length > 0 && (
                <input
                  type="checkbox"
                  checked={allEligibleSelected}
                  ref={(el) => {
                    if (el)
                      el.indeterminate = someSelected && !allEligibleSelected;
                  }}
                  onChange={onToggleAllSelection}
                  aria-label="Select all downloadable jobs"
                  style={{
                    width: "16px",
                    height: "16px",
                    cursor: "pointer",
                    accentColor: "var(--p-color-bg-fill-brand)",
                  }}
                />
              )}
              <span>Job ID</span>
            </div>
          </s-table-header>
          <s-table-header listSlot="inline">Status</s-table-header>
          <s-table-header listSlot="labeled" format="numeric">
            Quantity
          </s-table-header>
          <s-table-header listSlot="labeled" format="numeric">
            Value
          </s-table-header>
          <s-table-header listSlot="labeled" format="numeric">
            Total
          </s-table-header>
          <s-table-header listSlot="labeled">Created at</s-table-header>
          <s-table-header listSlot="labeled">Expired at</s-table-header>
          <s-table-header listSlot="inline">Mailed</s-table-header>
          <s-table-header>Actions</s-table-header>
        </s-table-header-row>

        <s-table-body>
          {jobs.map((job) => {
            const deactivationJobId = deactivatingJobMap[job.id];
            const isSelectable =
              job.status === "completed" &&
              canDownload(subscriptionPlan, new Date(job.createdAt));
            return (
              <DashboardJobRow
                key={job.id}
                job={job}
                subscriptionPlan={subscriptionPlan}
                shopCurrency={shopCurrency}
                progress={jobProgress[job.id]}
                activeJobAction={activeJobAction}
                isJobDeactivating={!!deactivationJobId}
                deactivationProgress={
                  deactivationJobId ? jobProgress[deactivationJobId] : undefined
                }
                isSelected={selectedJobIds.has(job.id)}
                isSelectable={isSelectable}
                hasSelectableJobs={eligibleJobs.length > 0}
                onToggleSelection={() => onToggleJobSelection(job.id)}
                onCancel={onCancel}
                onDeactivate={onDeactivate}
                onDownload={onDownload}
                onDuplicate={onDuplicate}
                onRetry={onRetry}
                onResume={onResume}
              />
            );
          })}
        </s-table-body>
      </s-table>
    </s-section>
  );
}

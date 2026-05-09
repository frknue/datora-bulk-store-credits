import { useLoaderData, useNavigate } from "react-router";
import { AppPageFooter } from "../components/app-page-footer";
import { authenticate } from "../shopify.server";
import { getStoreCreditJobWithRecipients } from "../lib/services/store-credit.server";
import { useJobProgressPolling } from "../lib/hooks/use-job-progress-polling";
import {
  formatDateString,
  formatNumber,
  getCurrencySymbol,
} from "../lib/utils/formatting";
import {
  getStoreCreditJobBadgeLabel,
  getStoreCreditJobBadgeTone,
  getStoreCreditRecipientBadgeTone,
} from "../lib/utils/store-credit-status";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const jobId = params.jobId;
  if (!jobId) {
    throw new Response("Missing job id", { status: 400 });
  }
  const job = await getStoreCreditJobWithRecipients(session.shop, jobId);
  if (!job) {
    throw new Response("Job not found", { status: 404 });
  }
  return {
    job: {
      id: job.id,
      status: job.status,
      amount: job.amount.toString(),
      currency: job.currency,
      count: job.count,
      done: job.done,
      failed: job.failed,
      notify: job.notify,
      note: job.note,
      expiresAt: job.expiresAt?.toISOString() ?? null,
      createdAt: job.createdAt.toISOString(),
      finishedAt: job.finishedAt?.toISOString() ?? null,
      scheduledTimestamp: job.scheduledTimestamp,
      scheduledMessage: job.scheduledMessage,
      errorMessage: job.errorMessage,
      recipients: job.recipients.map((r) => ({
        id: r.id,
        customerId: r.customerId,
        status: r.status,
        errorMessage: r.errorMessage,
        accountId: r.accountId,
        transactionId: r.transactionId,
        processedAt: r.processedAt?.toISOString() ?? null,
      })),
    },
  };
};

function KeyValueLine({ title, value }: { title: string; value: React.ReactNode }) {
  return (
    <s-stack direction="inline" justifyContent="space-between" gap="base">
      <s-text>{title}</s-text>
      <s-text>{value}</s-text>
    </s-stack>
  );
}

function RunningBanner({
  done,
  total,
  percent,
}: {
  done: number;
  total: number;
  percent: number;
}) {
  return (
    <s-banner tone="info">
      <s-stack direction="block" gap="small">
        <s-stack direction="inline" gap="small">
          <s-spinner size="base" />
          <s-text>
            Processing: {done} / {total} recipients ({percent}%)
          </s-text>
        </s-stack>
        <s-box background="subdued" borderRadius="base" blockSize="8px" overflow="hidden">
          <div
            style={{
              width: `${percent}%`,
              height: "100%",
              backgroundColor: "var(--p-color-text)",
              borderRadius: "4px",
              transition: "width 0.3s ease",
            }}
          />
        </s-box>
      </s-stack>
    </s-banner>
  );
}

export default function StoreCreditJobDetail() {
  const { job } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const isRunning = job.status === "running" || job.status === "pending";
  const progressMap = useJobProgressPolling(isRunning ? [job.id] : [], {
    endpoint: "/api/store-credits/progress",
    onTerminalStatus: () => navigate(".", { replace: true }),
  });
  const progress = progressMap[job.id] ?? null;

  const liveStatus =
    progress?.status && progress.status !== "unknown" ? progress.status : job.status;
  const done = progress?.done ?? job.done + job.failed;
  const total = progress?.total ?? job.count;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  const amountValue = Number(job.amount);
  const totalValue = amountValue * job.count;
  const currencySymbol = getCurrencySymbol(job.currency);

  const scheduledText = job.scheduledTimestamp
    ? formatDateString(job.scheduledTimestamp)
    : "now";

  return (
    <s-page
      heading={`Store credit ${job.id.slice(0, 8).toUpperCase()}`}
      inlineSize="base"
    >
      <s-link slot="breadcrumb-actions" href="/app/store-credit">
        Store Credits
      </s-link>

      <s-stack direction="block" gap="base">
        {isRunning && <RunningBanner done={done} total={total} percent={percent} />}

        {job.status === "failed" && job.errorMessage && (
          <s-banner tone="critical">
            <s-text>
              <strong>Error:</strong> {job.errorMessage}
            </s-text>
          </s-banner>
        )}

        <s-grid
          gridTemplateColumns="@container (inline-size <= 600px) 1fr, 2fr 1fr"
          gap="base"
        >
          <s-grid-item>
            <s-section heading={`Recipients (${formatNumber(job.count, 0)})`}>
              {job.recipients.length === 0 ? (
                <s-text>No recipients processed yet.</s-text>
              ) : (
                <s-table>
                  <s-table-header-row>
                    <s-table-header>Customer</s-table-header>
                    <s-table-header listSlot="inline">Status</s-table-header>
                    <s-table-header listSlot="labeled">Error</s-table-header>
                    <s-table-header listSlot="labeled">Processed</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {job.recipients.map((r) => {
                      const numericId = r.customerId.split("/").pop() || r.customerId;
                      return (
                        <s-table-row key={r.id}>
                          <s-table-cell>
                            <s-link
                              href={`shopify://admin/customers/${numericId}`}
                              target="_top"
                            >
                              <span style={{ fontFamily: "monospace" }}>
                                #{numericId}
                              </span>
                            </s-link>
                          </s-table-cell>
                          <s-table-cell>
                            <s-badge tone={getStoreCreditRecipientBadgeTone(r.status)}>
                              {r.status}
                            </s-badge>
                          </s-table-cell>
                          <s-table-cell>
                            <s-text>{r.errorMessage || "—"}</s-text>
                          </s-table-cell>
                          <s-table-cell>
                            <s-text>
                              {r.processedAt ? formatDateString(r.processedAt) : "—"}
                            </s-text>
                          </s-table-cell>
                        </s-table-row>
                      );
                    })}
                  </s-table-body>
                </s-table>
              )}
            </s-section>
          </s-grid-item>

          <s-grid-item>
            <s-stack direction="block" gap="base">
              <s-box
                border="base"
                borderColor="subdued"
                borderRadius="large-100"
                padding="base"
                background="base"
              >
                <s-stack direction="block" gap="base">
                  <KeyValueLine
                    title="Status"
                    value={
                      <s-badge tone={getStoreCreditJobBadgeTone(liveStatus)}>
                        {getStoreCreditJobBadgeLabel(liveStatus)}
                      </s-badge>
                    }
                  />
                  <s-divider />
                  <s-stack direction="block" gap="small">
                    <s-heading>{formatNumber(job.count, 0)}</s-heading>
                    <s-text color="subdued">Recipients</s-text>
                  </s-stack>
                  <s-divider />
                  <s-stack direction="block" gap="small">
                    <KeyValueLine
                      title="Amount:"
                      value={`${formatNumber(amountValue)} ${currencySymbol}`}
                    />
                    <KeyValueLine
                      title="Total:"
                      value={`${formatNumber(totalValue)} ${currencySymbol}`}
                    />
                    <KeyValueLine title="Succeeded:" value={formatNumber(job.done, 0)} />
                    <KeyValueLine
                      title="Failed:"
                      value={
                        job.failed > 0 ? (
                          <s-badge tone="critical">{job.failed}</s-badge>
                        ) : (
                          formatNumber(job.failed, 0)
                        )
                      }
                    />
                  </s-stack>
                </s-stack>
              </s-box>

              {job.scheduledTimestamp && (
                <s-box
                  border="base"
                  borderColor="subdued"
                  borderRadius="large-100"
                  padding="base"
                  background="base"
                >
                  <s-stack direction="block" gap="small">
                    <KeyValueLine title="Scheduled to:" value={scheduledText} />
                    {job.scheduledMessage && (
                      <KeyValueLine title="Message:" value={job.scheduledMessage} />
                    )}
                  </s-stack>
                </s-box>
              )}

              <s-box
                border="base"
                borderColor="subdued"
                borderRadius="large-100"
                padding="base"
                background="base"
              >
                <s-stack direction="block" gap="small">
                  <KeyValueLine title="Currency:" value={job.currency} />
                  <KeyValueLine
                    title="Notify customer:"
                    value={job.notify ? "Yes" : "No"}
                  />
                  <KeyValueLine
                    title="Expires at:"
                    value={job.expiresAt ? formatDateString(job.expiresAt) : "Never"}
                  />
                  <KeyValueLine title="Note:" value={job.note || "—"} />
                  <s-divider />
                  <KeyValueLine
                    title="Created at:"
                    value={formatDateString(job.createdAt)}
                  />
                  <KeyValueLine
                    title="Finished at:"
                    value={job.finishedAt ? formatDateString(job.finishedAt) : "—"}
                  />
                </s-stack>
              </s-box>
            </s-stack>
          </s-grid-item>
        </s-grid>

        <AppPageFooter />
      </s-stack>
    </s-page>
  );
}

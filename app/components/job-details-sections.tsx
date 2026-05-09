import { formatDateString, formatNumber } from "../lib/utils/formatting";
import type { JobDetailsGiftCard, JobDetailsPageJob } from "../lib/types/jobs";

export { JobUsageTrackingSection } from "../features/job-details/components/job-usage-tracking-section";

interface JobRunningProgressBannerProps {
  done: number;
  total: number;
  progressPercent: number;
}

interface JobErrorBannerProps {
  errorMessage: string;
}

interface JobSuccessBannerProps {
  total: number;
}

interface JobGiftCardListSectionProps {
  shopHandle: string;
  totalCards: number;
  paginatedCards: JobDetailsGiftCard[];
  cardPage: number;
  totalCardPages: number;
  cardsPerPage: number;
  onCardPageChange: (page: number) => void;
}

interface JobSidebarSectionProps {
  job: JobDetailsPageJob;
  currency: string;
  hasMailed: boolean;
  displayStatus: string;
}

function KeyValueLine({ title, value }: { title: string; value: React.ReactNode }) {
  return (
    <s-stack direction="inline" justifyContent="space-between" gap="base">
      <s-text>{title}</s-text>
      <s-text>{value}</s-text>
    </s-stack>
  );
}

function maskCode(code: string): string {
  if (!code) return "---";
  const lastFour = code.slice(-4);
  const codeLength = code.length < 8 ? 8 : code.length;
  const bulletCount = codeLength - 4;
  const bullets = "•".repeat(bulletCount);
  const formattedBullets = bullets.match(/.{1,4}/g)?.join(" ") ?? "";
  return `${formattedBullets} ${lastFour}`;
}

export function JobRunningProgressBanner({
  done,
  total,
  progressPercent,
}: JobRunningProgressBannerProps) {
  return (
    <s-banner tone="info">
      <s-stack direction="block" gap="small">
        <s-stack direction="inline" gap="small">
          <s-spinner size="base" />
          <s-text>
            Processing: {done} / {total} gift cards ({progressPercent}%)
          </s-text>
        </s-stack>
        <s-stack direction="block" gap="small">
          <s-box
            background="subdued"
            borderRadius="base"
            blockSize="8px"
            overflow="hidden"
          >
            <div
              style={{
                width: `${progressPercent}%`,
                height: "100%",
                backgroundColor: "var(--p-color-text)",
                borderRadius: "4px",
                transition: "width 0.3s ease",
              }}
            />
          </s-box>
          <s-text>{progressPercent}% complete</s-text>
        </s-stack>
      </s-stack>
    </s-banner>
  );
}

export function JobErrorBanner({ errorMessage }: JobErrorBannerProps) {
  return (
    <s-banner tone="critical">
      <s-text>
        <strong>Error:</strong> {errorMessage}
      </s-text>
    </s-banner>
  );
}

export function JobSuccessBanner({ total }: JobSuccessBannerProps) {
  return (
    <s-banner tone="success">
      <s-text>
        <strong>Job completed.</strong> {formatNumber(total, 0)} gift card
        {total === 1 ? " was" : "s were"} created successfully.
      </s-text>
    </s-banner>
  );
}

export function JobGiftCardListSection({
  shopHandle,
  totalCards,
  paginatedCards,
  cardPage,
  totalCardPages,
  onCardPageChange,
}: JobGiftCardListSectionProps) {
  return (
    <s-box
      border="base"
      borderColor="subdued"
      borderRadius="large-100"
      background="base"
      overflow="hidden"
    >
      {totalCards === 0 ? (
        <s-box padding="base">
          <s-text>No gift cards generated yet.</s-text>
        </s-box>
      ) : (
        <>
          <s-table
            paginate
            hasPreviousPage={cardPage > 1 || undefined}
            hasNextPage={cardPage < totalCardPages || undefined}
            onPreviousPage={() => onCardPageChange(cardPage - 1)}
            onNextPage={() => onCardPageChange(cardPage + 1)}
          >
            <s-table-header-row>
              <s-table-header>ID</s-table-header>
              <s-table-header>Code</s-table-header>
            </s-table-header-row>

            <s-table-body>
              {paginatedCards.map((giftCard, index) => (
                <s-table-row key={giftCard.id || index}>
                  <s-table-cell>
                    {giftCard.id ? (
                      <s-link
                        href={`https://admin.shopify.com/store/${shopHandle}/gift_cards/${giftCard.id}`}
                        target="_top"
                        tone="neutral"
                      >
                        #{giftCard.id}
                      </s-link>
                    ) : (
                      "—"
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    <code>{maskCode(giftCard.code)}</code>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </>
      )}
    </s-box>
  );
}

function getStatusBadgeTone(status: string) {
  if (status === "completed") return "success";
  if (status === "deactivated") return "warning";
  if (status === "failed") return "critical";
  if (status === "cancelled") return "neutral";
  if (status === "running" || status === "pending") return "info";
  return "warning";
}

export function JobSidebarSection({
  job,
  currency,
  hasMailed,
  displayStatus,
}: JobSidebarSectionProps) {
  const jobValue = job.value;
  const jobTotal = job.count * jobValue;

  const scheduledText =
    job.scheduledDate && job.scheduledTime
      ? `${job.scheduledDate} ${job.scheduledTime}${job.scheduledTimezone ? ` (${job.scheduledTimezone})` : ""}`
      : "now";

  return (
    <s-stack direction="block" gap="base">
      {/* Card 1: Stats */}
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
              <s-badge tone={getStatusBadgeTone(displayStatus)}>{displayStatus}</s-badge>
            }
          />
          <s-divider />
          <s-stack direction="block" gap="small">
            <s-heading>{formatNumber(job.count, 0)}</s-heading>
            <s-text color="subdued">Gift Cards</s-text>
          </s-stack>
          <s-divider />
          <s-stack direction="block" gap="small">
            <KeyValueLine
              title="Value:"
              value={`${formatNumber(jobValue)} ${currency}`}
            />
            <KeyValueLine
              title="Total:"
              value={`${formatNumber(jobTotal)} ${currency}`}
            />
          </s-stack>
        </s-stack>
      </s-box>

      {/* Card 2: Mail status (conditional) */}
      {hasMailed && (
        <s-box
          border="base"
          borderColor="subdued"
          borderRadius="large-100"
          padding="base"
          background="base"
        >
          <s-stack direction="block" gap="small">
            <KeyValueLine
              title="Mailed"
              value={
                job.status === "completed" ? (
                  <s-badge tone="success">completed</s-badge>
                ) : job.status === "failed" ? (
                  <s-badge tone="critical">failed</s-badge>
                ) : (
                  <s-badge tone="info">pending</s-badge>
                )
              }
            />
            <KeyValueLine title="Scheduled to:" value={scheduledText} />
            {job.scheduledMessage && (
              <KeyValueLine title="Message:" value={job.scheduledMessage} />
            )}
          </s-stack>
        </s-box>
      )}

      {/* Card 3: Configuration details */}
      <s-box
        border="base"
        borderColor="subdued"
        borderRadius="large-100"
        padding="base"
        background="base"
      >
        <s-stack direction="block" gap="small">
          <KeyValueLine title="Prefix:" value={job.prefix || "---"} />
          <KeyValueLine title="Postfix:" value={job.postfix || "---"} />
          <KeyValueLine title="Code Length:" value={String(job.codeLength || 16)} />
          <KeyValueLine title="Expired at:" value={job.expireDate || "---"} />
          <KeyValueLine title="Note:" value={job.note || "---"} />
          <s-divider />
          <KeyValueLine
            title="Created at:"
            value={formatDateString(job.createdAt as unknown as string)}
          />
          <KeyValueLine
            title="Finished at:"
            value={
              job.finishedAt
                ? formatDateString(job.finishedAt as unknown as string)
                : "---"
            }
          />
        </s-stack>
      </s-box>
    </s-stack>
  );
}

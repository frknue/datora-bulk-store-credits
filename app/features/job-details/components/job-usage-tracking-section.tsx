import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDateString, formatNumber } from "../../../lib/utils/formatting";
import type {
  GiftCardUsageRecord,
  UsageMetrics,
  UsageRefreshProgress,
} from "../../../lib/types";

interface JobUsageTrackingSectionProps {
  currency: string;
  shopHandle: string;
  usageMetrics: UsageMetrics | null;
  usageRecords: GiftCardUsageRecord[];
  usagePreviewCount: number;
  usageRecordCount: number;
  usagePage: number;
  totalUsagePages: number;
  usageRecordsPerPage: number;
  usageError: string | null;
  usageLastRefreshedAt?: string | null;
  usageCooldownRemaining: number;
  usageLoading: boolean;
  usageRefreshProgress?: UsageRefreshProgress | null;
  onUsagePageChange: (page: number) => void;
  onExportUsage: () => void;
  onRefreshUsage: () => void;
}

const USAGE_CHART_COLORS = {
  used: "#0a7f5a",
  partial: "#d6a73a",
  unused: "#8c9196",
  initial: "#5c6ac4",
  current: "#008060",
  redeemed: "#d72c0d",
};

function KeyValueLine({ title, value }: { title: string; value: React.ReactNode }) {
  return (
    <s-stack direction="inline" justifyContent="space-between" gap="base">
      <s-text>{title}</s-text>
      <s-text>{value}</s-text>
    </s-stack>
  );
}

function formatCurrencyAmount(value: number, currency: string): string {
  return `${formatNumber(value)} ${currency}`;
}

function formatCooldownLabel(remainingMs: number): string {
  const minutes = Math.floor(remainingMs / 60000);
  const seconds = Math.floor((remainingMs % 60000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function extractNumericGiftCardId(giftCardId: string): string {
  const parts = giftCardId.split("/");
  return parts[parts.length - 1] || giftCardId;
}

function renderGiftCardStatusBadge(status: string) {
  if (status === "enabled") return <s-badge tone="success">Enabled</s-badge>;
  if (status === "disabled") return <s-badge tone="critical">Disabled</s-badge>;
  if (status === "expired") return <s-badge tone="warning">Expired</s-badge>;
  return <s-badge>{status}</s-badge>;
}

function renderUsageStatusBadge(balanceStatus: string) {
  if (balanceStatus === "empty") return <s-badge tone="info">Fully Used</s-badge>;
  if (balanceStatus === "partial") {
    return <s-badge tone="warning">Partially Used</s-badge>;
  }

  return <s-badge>Unused</s-badge>;
}

function UsageMetricCard({
  label,
  value,
  progress,
}: {
  label: string;
  value: string;
  progress?: number;
}) {
  return (
    <s-box
      border="base"
      borderColor="subdued"
      borderRadius="large-100"
      padding="base"
      background="base"
    >
      <s-stack direction="block" gap="small">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
        {typeof progress === "number" && (
          <div
            style={{
              height: "8px",
              borderRadius: "999px",
              backgroundColor: "var(--p-color-bg-surface-secondary)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${Math.max(0, Math.min(100, progress))}%`,
                height: "100%",
                backgroundColor: USAGE_CHART_COLORS.initial,
                borderRadius: "999px",
                transition: "width 0.3s ease",
              }}
            />
          </div>
        )}
      </s-stack>
    </s-box>
  );
}

function UsageChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <s-box
      border="base"
      borderColor="subdued"
      borderRadius="large-100"
      padding="base"
      background="base"
    >
      <s-stack direction="block" gap="small">
        <s-text type="strong">{title}</s-text>
        {subtitle ? <s-text color="subdued">{subtitle}</s-text> : null}
        <s-box paddingBlockStart="small" blockSize="320px" inlineSize="100%">
          {children}
        </s-box>
      </s-stack>
    </s-box>
  );
}

export function JobUsageTrackingSection({
  currency,
  shopHandle,
  usageMetrics,
  usageRecords,
  usagePreviewCount,
  usageRecordCount,
  usagePage,
  totalUsagePages,
  usageError,
  usageLastRefreshedAt,
  usageCooldownRemaining,
  usageLoading,
  usageRefreshProgress,
  onUsagePageChange,
  onExportUsage,
  onRefreshUsage,
}: JobUsageTrackingSectionProps) {
  const refreshDisabled = usageCooldownRemaining > 0;
  const refreshLabel = refreshDisabled
    ? `Refresh (${formatCooldownLabel(usageCooldownRemaining)})`
    : "Refresh data";

  if (
    usageRefreshProgress &&
    (usageRefreshProgress.status === "queued" ||
      usageRefreshProgress.status === "processing")
  ) {
    const pct =
      usageRefreshProgress.total > 0
        ? Math.round((usageRefreshProgress.done / usageRefreshProgress.total) * 100)
        : 0;
    const totalCardsLabel = formatNumber(usageRefreshProgress.total, 0);
    const processedCardsLabel = formatNumber(usageRefreshProgress.done, 0);

    return (
      <s-section heading="Gift Card Usage Tracking">
        <s-banner tone="info">
          <s-text>
            You can close this page — processing will continue in the background. Refresh
            the page to check progress.
          </s-text>
        </s-banner>

        <s-box
          border="base"
          borderColor="subdued"
          borderRadius="large-100"
          padding="large"
          background="base"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
                alignItems: "center",
                padding: "1.5rem 0 0",
              }}
            >
              <s-spinner size="large" accessibilityLabel="Processing usage data" />
              <s-heading>
                {usageRefreshProgress.total > 0
                  ? "Processing Gift Card Usage Data"
                  : "Preparing Usage Data..."}
              </s-heading>
              {usageRefreshProgress.total > 0 && (
                <s-text color="subdued">
                  This may take a few minutes for large batches.
                </s-text>
              )}
            </div>

            {usageRefreshProgress.total > 0 && (
              <div style={{ width: "100%", padding: "0 1rem" }}>
                <div style={{ textAlign: "center", marginBottom: "0.75rem" }}>
                  <s-text>
                    {processedCardsLabel} of {totalCardsLabel} cards ({pct}%)
                  </s-text>
                </div>
                <div
                  style={{
                    width: "100%",
                    height: "8px",
                    borderRadius: "999px",
                    backgroundColor: "var(--p-color-bg-surface-secondary)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: "100%",
                      backgroundColor: "var(--p-color-bg-fill-success)",
                      borderRadius: "999px",
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </s-box>
      </s-section>
    );
  }

  if (usageLoading) {
    return (
      <s-section heading="Gift Card Usage Tracking">
        <s-box
          border="base"
          borderColor="subdued"
          borderRadius="large-100"
          padding="large"
          background="base"
        >
          <s-stack
            direction="block"
            gap="base"
            alignItems="center"
            paddingBlock="large-300"
          >
            <s-spinner size="large" accessibilityLabel="Loading usage data" />
            <s-text type="strong">Loading usage data...</s-text>
            <s-text color="subdued">
              Fetching the latest redemption and balance information.
            </s-text>
          </s-stack>
        </s-box>
      </s-section>
    );
  }

  if (usageError && !usageMetrics) {
    return (
      <s-section heading="Gift Card Usage Tracking">
        <s-stack direction="block" gap="base">
          <s-banner tone="critical">
            <s-text>{usageError}</s-text>
          </s-banner>
          <s-button
            variant="primary"
            onClick={onRefreshUsage}
            disabled={refreshDisabled || undefined}
          >
            Try again
          </s-button>
        </s-stack>
      </s-section>
    );
  }

  if (!usageMetrics) {
    return (
      <s-section heading="Gift Card Usage Tracking">
        <s-box
          border="base"
          borderColor="subdued"
          borderRadius="large-100"
          padding="large"
          background="base"
        >
          <s-stack
            direction="block"
            gap="base"
            alignItems="center"
            paddingBlock="large-300"
            paddingInline="base"
          >
            <s-text type="strong">No usage data available</s-text>
            <s-text>Fetch the latest redemption and balance data from Shopify.</s-text>
            <s-button
              variant="primary"
              onClick={onRefreshUsage}
              disabled={refreshDisabled || undefined}
            >
              Fetch usage data
            </s-button>
          </s-stack>
        </s-box>
      </s-section>
    );
  }

  const pieChartData = [
    {
      name: "Fully Used",
      value: usageMetrics.emptyBalance,
      color: USAGE_CHART_COLORS.used,
    },
    {
      name: "Partially Used",
      value: usageMetrics.partialBalance,
      color: USAGE_CHART_COLORS.partial,
    },
    {
      name: "Unused",
      value: usageMetrics.fullBalance,
      color: USAGE_CHART_COLORS.unused,
    },
  ];

  const barChartData = [
    {
      name: "Initial Value",
      value: usageMetrics.totalInitialValue,
      color: USAGE_CHART_COLORS.initial,
    },
    {
      name: "Current Balance",
      value: usageMetrics.totalCurrentBalance,
      color: USAGE_CHART_COLORS.current,
    },
    {
      name: "Amount Redeemed",
      value: usageMetrics.totalRedeemed,
      color: USAGE_CHART_COLORS.redeemed,
    },
  ];
  return (
    <s-section heading="Gift Card Usage Tracking">
      <s-stack direction="block" gap="base">
        {usageError && (
          <s-banner tone="critical">
            <s-text>{usageError}</s-text>
          </s-banner>
        )}

        <s-grid
          gridTemplateColumns="@container (inline-size <= 700px) 1fr 1fr, 1fr 1fr 1fr 1fr"
          gap="base"
        >
          <UsageMetricCard
            label="Total Redeemed"
            value={formatCurrencyAmount(usageMetrics.totalRedeemed, currency)}
          />
          <UsageMetricCard
            label="Redemption Rate"
            value={`${usageMetrics.redemptionRate.toFixed(1)}%`}
            progress={usageMetrics.redemptionRate}
          />
          <UsageMetricCard
            label="Fully Used"
            value={formatNumber(usageMetrics.emptyBalance, 0)}
          />
          <UsageMetricCard
            label="Partially Used"
            value={formatNumber(usageMetrics.partialBalance, 0)}
          />
        </s-grid>

        <s-grid
          gridTemplateColumns="@container (inline-size <= 600px) 1fr, 1fr 1fr"
          gap="base"
        >
          <UsageChartCard title="Redemption Status Distribution">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieChartData}
                  cx="50%"
                  cy="50%"
                  outerRadius={92}
                  dataKey="value"
                  nameKey="name"
                  labelLine={false}
                  label={({ percent }) => `${((percent || 0) * 100).toFixed(0)}%`}
                >
                  {pieChartData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => formatNumber(Number(value), 0)} />
                <Legend verticalAlign="bottom" height={36} />
              </PieChart>
            </ResponsiveContainer>
          </UsageChartCard>

          <UsageChartCard title="Value Overview">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={barChartData}
                margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value: number) => `${Math.round(value)}`}
                />
                <Tooltip
                  formatter={(value: number) =>
                    formatCurrencyAmount(Number(value), currency)
                  }
                />
                <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                  {barChartData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </UsageChartCard>
        </s-grid>

        <s-box
          border="base"
          borderColor="subdued"
          borderRadius="large-100"
          padding="base"
          background="base"
        >
          <s-stack direction="block" gap="base">
            <s-stack
              direction="inline"
              justifyContent="space-between"
              gap="base"
              {...{ style: { flexWrap: "wrap" } }}
            >
              <s-stack direction="block" gap="small">
                <s-text type="strong">Gift Card Details</s-text>
                <s-text color="subdued">
                  Last updated:{" "}
                  {usageLastRefreshedAt
                    ? formatDateString(usageLastRefreshedAt)
                    : "Never"}
                </s-text>
              </s-stack>
              <s-stack direction="inline" gap="small">
                <s-button
                  variant="secondary"
                  {...{ size: "small" }}
                  onClick={onExportUsage}
                >
                  Export CSV
                </s-button>
                <s-button
                  variant="primary"
                  {...{ size: "small" }}
                  onClick={onRefreshUsage}
                  disabled={refreshDisabled || undefined}
                >
                  {refreshLabel}
                </s-button>
              </s-stack>
            </s-stack>

            <s-grid
              gridTemplateColumns="@container (inline-size <= 600px) 1fr, 1fr 1fr 1fr"
              gap="base"
            >
              <s-box background="subdued" borderRadius="large-100" padding="base">
                <s-stack direction="block" gap="small">
                  <s-text type="strong">Balance Status</s-text>
                  <s-stack direction="inline" gap="small">
                    <s-badge>Unused: {usageMetrics.fullBalance}</s-badge>
                    <s-badge tone="warning">
                      Partial: {usageMetrics.partialBalance}
                    </s-badge>
                    <s-badge tone="info">Used: {usageMetrics.emptyBalance}</s-badge>
                  </s-stack>
                </s-stack>
              </s-box>
              <s-box background="subdued" borderRadius="large-100" padding="base">
                <s-stack direction="block" gap="small">
                  <s-text type="strong">Card Status</s-text>
                  <s-stack direction="inline" gap="small">
                    <s-badge tone="success">Enabled: {usageMetrics.enabled}</s-badge>
                    <s-badge tone="critical">Disabled: {usageMetrics.disabled}</s-badge>
                    <s-badge tone="warning">Expired: {usageMetrics.expired}</s-badge>
                  </s-stack>
                </s-stack>
              </s-box>
            </s-grid>

            <s-box background="subdued" borderRadius="large-100" padding="base">
              <s-stack direction="block" gap="small">
                <s-text type="strong">Value Overview</s-text>
                <KeyValueLine
                  title="Total Cards:"
                  value={<strong>{formatNumber(usageMetrics.totalCards, 0)}</strong>}
                />
                <KeyValueLine
                  title="Initial Value:"
                  value={
                    <strong>
                      {formatCurrencyAmount(usageMetrics.totalInitialValue, currency)}
                    </strong>
                  }
                />
                <KeyValueLine
                  title="Current Balance:"
                  value={
                    <strong>
                      {formatCurrencyAmount(usageMetrics.totalCurrentBalance, currency)}
                    </strong>
                  }
                />
                <KeyValueLine
                  title="Amount Redeemed:"
                  value={
                    <strong>
                      {formatCurrencyAmount(usageMetrics.totalRedeemed, currency)}
                    </strong>
                  }
                />
              </s-stack>
            </s-box>

            {usageRecordCount > usagePreviewCount && (
              <s-text color="subdued">
                Showing the first {usagePreviewCount} gift cards. Export CSV to
                view all {usageRecordCount} records.
              </s-text>
            )}

            <s-box
              border="base"
              borderColor="subdued"
              borderRadius="large-100"
              overflow="hidden"
            >
              <s-table
                paginate
                hasPreviousPage={usagePage > 1 || undefined}
                hasNextPage={usagePage < totalUsagePages || undefined}
                onPreviousPage={() => onUsagePageChange(usagePage - 1)}
                onNextPage={() => onUsagePageChange(usagePage + 1)}
              >
                <s-table-header-row>
                  <s-table-header listSlot="secondary">ID</s-table-header>
                  <s-table-header listSlot="inline">Last 4</s-table-header>
                  <s-table-header listSlot="labeled">Initial Value</s-table-header>
                  <s-table-header listSlot="labeled">Current Balance</s-table-header>
                  <s-table-header listSlot="labeled">Redeemed</s-table-header>
                  <s-table-header listSlot="inline">Status</s-table-header>
                  <s-table-header>Usage Status</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {usageRecords.map((record) => {
                    const numericId = extractNumericGiftCardId(record.giftCardId);

                    return (
                      <s-table-row key={record.giftCardId}>
                        <s-table-cell>
                          <s-link
                            href={`https://admin.shopify.com/store/${shopHandle}/gift_cards/${numericId}`}
                            target="_top"
                            tone="neutral"
                          >
                            #{numericId}
                          </s-link>
                        </s-table-cell>
                        <s-table-cell>{record.lastCharacters}</s-table-cell>
                        <s-table-cell>
                          {formatCurrencyAmount(record.initialValue, currency)}
                        </s-table-cell>
                        <s-table-cell>
                          {formatCurrencyAmount(record.currentBalance, currency)}
                        </s-table-cell>
                        <s-table-cell>
                          {formatCurrencyAmount(record.amountRedeemed, currency)}
                        </s-table-cell>
                        <s-table-cell>
                          {renderGiftCardStatusBadge(record.status)}
                        </s-table-cell>
                        <s-table-cell>
                          {renderUsageStatusBadge(record.balanceStatus)}
                        </s-table-cell>
                      </s-table-row>
                    );
                  })}
                </s-table-body>
              </s-table>
            </s-box>
          </s-stack>
        </s-box>
      </s-stack>
    </s-section>
  );
}

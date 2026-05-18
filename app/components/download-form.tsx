import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { downloadJob, downloadBatchJobs } from "../lib/utils/download";
import { AppPageFooter } from "./app-page-footer";
import type { SubscriptionPlan } from "../lib/subscriptions/plans";

const FIELD_OPTIONS: { key: string; label: string; defaultOn: boolean }[] = [
  { key: "id", label: "ID", defaultOn: true },
  { key: "last_characters", label: "Last Characters", defaultOn: false },
  { key: "balance", label: "Balance", defaultOn: false },
  { key: "currency", label: "Currency", defaultOn: false },
  { key: "value", label: "Value", defaultOn: true },
  { key: "note", label: "Note", defaultOn: true },
  { key: "expires_on", label: "Expires On", defaultOn: true },
  { key: "disabled_at", label: "Disabled At", defaultOn: false },
  { key: "status", label: "Status", defaultOn: false },
  { key: "created_at", label: "Created At", defaultOn: true },
];

function buildDefaultFields(): Record<string, boolean> {
  const fields: Record<string, boolean> = {};
  for (const f of FIELD_OPTIONS) {
    fields[f.key] = f.defaultOn;
  }
  return fields;
}

export interface DownloadPreviewMeta {
  prefix?: string | null;
  postfix?: string | null;
  value?: number | null;
  note?: string | null;
  expireDate?: string | null;
  currency?: string | null;
}

export interface DownloadFormProps {
  mode: "single" | "batch";
  jobIds: string[];
  subscriptionPlan: SubscriptionPlan;
  backHref: string;
  previewMeta?: DownloadPreviewMeta;
}

const PREVIEW_BASE_CODES = [
  "ab12cd34ef56gh78",
  "9q8w7e6r5t4y3u2i",
  "mnbvcxz1a2s3d4f5",
];

const PREVIEW_IDS = ["1029384756", "1029384757", "1029384758"];

export function DownloadForm({
  mode,
  jobIds,
  subscriptionPlan,
  backHref,
  previewMeta,
}: DownloadFormProps) {
  const shopify = useAppBridge();
  const navigate = useNavigate();

  const [delimiter, setDelimiter] = useState("comma");
  const [selectedFields, setSelectedFields] =
    useState<Record<string, boolean>>(buildDefaultFields);
  const [uppercase, setUppercase] = useState(false);
  const [splitter, setSplitter] = useState(false);
  const [loading, setLoading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const canFormat = subscriptionPlan.formatter;

  const previewRows = useMemo(() => {
    const prefix = previewMeta?.prefix ?? "";
    const postfix = previewMeta?.postfix ?? "";
    const value =
      typeof previewMeta?.value === "number" ? previewMeta.value : 25;
    const currency = previewMeta?.currency ?? "USD";
    const note = previewMeta?.note ?? "Example note";
    const expiresOn = previewMeta?.expireDate ?? "";
    const createdAt = new Date().toISOString();
    const balance = value.toFixed(2);

    return PREVIEW_BASE_CODES.map((base, i) => {
      const rawCode = `${prefix}${base}${postfix}`;
      let code = rawCode;
      if (canFormat && uppercase) code = code.toUpperCase();
      if (canFormat && splitter)
        code = code.match(/.{1,4}/g)?.join("-") || code;
      return {
        code,
        id: PREVIEW_IDS[i],
        last_characters: rawCode.slice(-4),
        balance,
        currency,
        value: balance,
        note,
        expires_on: expiresOn,
        disabled_at: "",
        status: "ENABLED",
        created_at: createdAt,
      } as Record<string, string>;
    });
  }, [previewMeta, canFormat, uppercase, splitter]);

  const previewColumns = useMemo(() => {
    const cols: { key: string; label: string }[] = [
      { key: "code", label: "Code" },
    ];
    for (const f of FIELD_OPTIONS) {
      if (selectedFields[f.key]) cols.push({ key: f.key, label: f.label });
    }
    return cols;
  }, [selectedFields]);

  const midpoint = Math.ceil(FIELD_OPTIONS.length / 2);
  const leftFields = FIELD_OPTIONS.slice(0, midpoint);
  const rightFields = FIELD_OPTIONS.slice(midpoint);

  const handleFieldToggle = useCallback((key: string, checked: boolean) => {
    setSelectedFields((prev) => ({ ...prev, [key]: checked }));
  }, []);

  const handleDownload = useCallback(async () => {
    const fields = Object.entries(selectedFields)
      .filter(([, checked]) => checked)
      .map(([key]) => key);

    setLoading(true);
    const result =
      mode === "batch"
        ? await downloadBatchJobs(
            jobIds,
            subscriptionPlan.id,
            fields,
            delimiter,
            uppercase,
            splitter,
          )
        : await downloadJob(
            jobIds[0],
            subscriptionPlan.id,
            fields,
            delimiter,
            uppercase,
            splitter,
          );
    setLoading(false);

    if (result.success) {
      setDownloadError(null);
      shopify.toast.show("Download started");
      navigate(backHref);
    } else {
      setDownloadError(
        result.message ??
          "Couldn't prepare your download. Please try again in a moment.",
      );
    }
  }, [
    mode,
    jobIds,
    subscriptionPlan.id,
    selectedFields,
    delimiter,
    uppercase,
    splitter,
    shopify,
    navigate,
    backHref,
  ]);

  return (
    <s-stack direction="block" gap="base">
      <s-section padding="base">
        <s-stack direction="block" gap="base">
          {downloadError && (
            <s-banner tone="critical">{downloadError}</s-banner>
          )}

          <s-select
            label="Separator"
            value={delimiter}
            onChange={(event: Event) =>
              setDelimiter((event.target as HTMLSelectElement).value)
            }
            disabled={loading || undefined}
          >
            <s-option value="comma">Comma separated (,)</s-option>
            <s-option value="semicolon">Semicolon separated (;)</s-option>
          </s-select>

          <s-divider />

          <s-text type="strong">Fields</s-text>
          <s-text>Select the fields to include. Code is always included.</s-text>

          <s-grid
            gridTemplateColumns="@container (inline-size <= 600px) 1fr, 1fr 1fr"
            gap="base"
          >
            <s-stack direction="block" gap="small">
              <s-checkbox label="Code" checked disabled />
              {leftFields.map((field) => (
                <s-checkbox
                  key={field.key}
                  label={field.label}
                  checked={selectedFields[field.key] || undefined}
                  disabled={loading || undefined}
                  onChange={(event: Event) =>
                    handleFieldToggle(
                      field.key,
                      (event.target as HTMLInputElement).checked,
                    )
                  }
                />
              ))}
            </s-stack>
            <s-stack direction="block" gap="small">
              {rightFields.map((field) => (
                <s-checkbox
                  key={field.key}
                  label={field.label}
                  checked={selectedFields[field.key] || undefined}
                  disabled={loading || undefined}
                  onChange={(event: Event) =>
                    handleFieldToggle(
                      field.key,
                      (event.target as HTMLInputElement).checked,
                    )
                  }
                />
              ))}
            </s-stack>
          </s-grid>

          <s-divider />

          <s-text type="strong">Code Format</s-text>
          <s-text>Define how the gift card code should be formatted.</s-text>

          <s-grid
            gridTemplateColumns="@container (inline-size <= 600px) 1fr, 1fr 1fr"
            gap="base"
          >
            <s-checkbox
              label="Uppercase"
              checked={uppercase || undefined}
              disabled={loading || !canFormat || undefined}
              onChange={(event: Event) =>
                setUppercase((event.target as HTMLInputElement).checked)
              }
            />
            <s-checkbox
              label="Splitted"
              checked={splitter || undefined}
              disabled={loading || !canFormat || undefined}
              onChange={(event: Event) =>
                setSplitter((event.target as HTMLInputElement).checked)
              }
            />
          </s-grid>

          {!canFormat ? (
            <s-text>
              To format codes,{" "}
              <s-link href="/app/subscriptions">upgrade your plan</s-link>.
            </s-text>
          ) : null}

          <s-divider />

          <s-text type="strong">Preview</s-text>
          <s-text>
            Sample rows showing how your CSV will look with the current
            selection.
          </s-text>
          <s-box
            border="base"
            borderColor="subdued"
            borderRadius="large-100"
            overflow="hidden"
          >
            <s-table>
              <s-table-header-row>
                {previewColumns.map((col) => (
                  <s-table-header key={col.key}>{col.label}</s-table-header>
                ))}
              </s-table-header-row>
              <s-table-body>
                {previewRows.map((row, i) => (
                  <s-table-row key={i}>
                    {previewColumns.map((col) => (
                      <s-table-cell key={col.key}>
                        {row[col.key] || "—"}
                      </s-table-cell>
                    ))}
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-box>

          <s-stack direction="inline" gap="small" justifyContent="end">
            <s-button
              variant="tertiary"
              onClick={() => navigate(backHref)}
              disabled={loading || undefined}
            >
              Cancel
            </s-button>
            <s-button
              variant="primary"
              onClick={handleDownload}
              disabled={loading || undefined}
              loading={loading || undefined}
            >
              Download
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <AppPageFooter />
    </s-stack>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router";
import { AppPageFooter } from "../components/app-page-footer";
import { authenticate } from "../shopify.server";
import {
  STORE_CREDIT_SUPPORTED_CURRENCIES,
  STORE_CREDIT_RULES,
  type CreateStoreCreditJobBody,
} from "../../shared/store-credit";
import { timezoneLabels } from "../lib/utils/timezone";
import type { StoreCreditPickerCustomer } from "./api.store-credits.customers";
import type { StoreCreditPickerSegment } from "./api.store-credits.segments";
import type { AppOutletContext } from "../lib/types/app";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { shopName: session.shop };
};

type SelectedCustomer = Pick<StoreCreditPickerCustomer, "id" | "name" | "email">;
type SelectedSegment = Pick<StoreCreditPickerSegment, "id" | "name" | "count">;

export default function CreateStoreCreditJob() {
  const { shopCurrency } = useOutletContext<AppOutletContext>();
  const navigate = useNavigate();

  const defaultCurrency =
    shopCurrency &&
    (STORE_CREDIT_SUPPORTED_CURRENCIES as readonly string[]).includes(shopCurrency)
      ? (shopCurrency as CreateStoreCreditJobBody["currency"])
      : "EUR";

  const [amount, setAmount] = useState("");
  const [currency, setCurrency] =
    useState<CreateStoreCreditJobBody["currency"]>(defaultCurrency);
  const [selectedCustomers, setSelectedCustomers] = useState<SelectedCustomer[]>(
    [],
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerResults, setPickerResults] = useState<StoreCreditPickerCustomer[]>(
    [],
  );
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [pendingSelected, setPendingSelected] = useState<SelectedCustomer[]>([]);
  const pickerModalRef = useRef<
    HTMLElement & { showOverlay(): void; hideOverlay(): void }
  >(null);
  const [selectedSegments, setSelectedSegments] = useState<SelectedSegment[]>(
    [],
  );
  const [segmentPickerOpen, setSegmentPickerOpen] = useState(false);
  const [segmentQuery, setSegmentQuery] = useState("");
  const [segmentResults, setSegmentResults] = useState<
    StoreCreditPickerSegment[]
  >([]);
  const [segmentLoading, setSegmentLoading] = useState(false);
  const [segmentError, setSegmentError] = useState<string | null>(null);
  const [pendingSegments, setPendingSegments] = useState<SelectedSegment[]>([]);
  const segmentPickerModalRef = useRef<
    HTMLElement & { showOverlay(): void; hideOverlay(): void }
  >(null);
  const [expireDate, setExpireDate] = useState("");
  const [notify, setNotify] = useState(true);
  const [note, setNote] = useState("");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [scheduledTimezone, setScheduledTimezone] = useState("");
  const [scheduledMessage, setScheduledMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const openCustomerPicker = useCallback(() => {
    setPickerQuery("");
    setPickerResults([]);
    setPickerError(null);
    setPendingSelected(selectedCustomers);
    setPickerOpen(true);
    pickerModalRef.current?.showOverlay();
  }, [selectedCustomers]);

  const closeCustomerPicker = useCallback(() => {
    setPickerOpen(false);
    pickerModalRef.current?.hideOverlay();
  }, []);

  const confirmCustomerSelection = useCallback(() => {
    setSelectedCustomers(pendingSelected);
    setErrorMessage(null);
    closeCustomerPicker();
  }, [pendingSelected, closeCustomerPicker]);

  function togglePendingCustomer(c: StoreCreditPickerCustomer) {
    setPendingSelected((prev) => {
      const exists = prev.some((p) => p.id === c.id);
      if (exists) return prev.filter((p) => p.id !== c.id);
      return [...prev, { id: c.id, name: c.name, email: c.email }];
    });
  }

  function toggleSelectAllVisible() {
    setPendingSelected((prev) => {
      const allVisibleSelected =
        pickerResults.length > 0 &&
        pickerResults.every((c) => prev.some((p) => p.id === c.id));
      // Master deselect clears every pending row, including any selected from a
      // prior search or session that isn't currently visible. Otherwise the
      // visible "0 checked" state would lie about the real count.
      if (allVisibleSelected) return [];
      const next = [...prev];
      const seen = new Set(prev.map((p) => p.id));
      for (const c of pickerResults) {
        if (!seen.has(c.id)) {
          next.push({ id: c.id, name: c.name, email: c.email });
          seen.add(c.id);
        }
      }
      return next;
    });
  }

  // Debounced server search while the picker modal is open.
  useEffect(() => {
    if (!pickerOpen) return;
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      setPickerLoading(true);
      setPickerError(null);
      try {
        const trimmed = pickerQuery.trim();
        const url = trimmed
          ? `/api/store-credits/customers?q=${encodeURIComponent(trimmed)}`
          : `/api/store-credits/customers`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          setPickerError("Failed to load customers. Try again.");
          setPickerResults([]);
          return;
        }
        const { customers } = (await res.json()) as {
          customers: StoreCreditPickerCustomer[];
        };
        setPickerResults(customers);
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setPickerError("Failed to load customers. Try again.");
        setPickerResults([]);
      } finally {
        setPickerLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [pickerOpen, pickerQuery]);

  function removeSelectedCustomer(id: string) {
    setSelectedCustomers((prev) => prev.filter((c) => c.id !== id));
  }

  const openSegmentPicker = useCallback(() => {
    setSegmentQuery("");
    setSegmentResults([]);
    setSegmentError(null);
    setPendingSegments(selectedSegments);
    setSegmentPickerOpen(true);
    segmentPickerModalRef.current?.showOverlay();
  }, [selectedSegments]);

  const closeSegmentPicker = useCallback(() => {
    setSegmentPickerOpen(false);
    segmentPickerModalRef.current?.hideOverlay();
  }, []);

  const confirmSegmentSelection = useCallback(() => {
    setSelectedSegments(pendingSegments);
    setErrorMessage(null);
    closeSegmentPicker();
  }, [pendingSegments, closeSegmentPicker]);

  function togglePendingSegment(s: StoreCreditPickerSegment) {
    setPendingSegments((prev) => {
      const exists = prev.some((p) => p.id === s.id);
      if (exists) return prev.filter((p) => p.id !== s.id);
      return [...prev, { id: s.id, name: s.name, count: s.count }];
    });
  }

  function removeSelectedSegment(id: string) {
    setSelectedSegments((prev) => prev.filter((s) => s.id !== id));
  }

  // Debounced server search for segments while the segment picker is open.
  useEffect(() => {
    if (!segmentPickerOpen) return;
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      setSegmentLoading(true);
      setSegmentError(null);
      try {
        const trimmed = segmentQuery.trim();
        const url = trimmed
          ? `/api/store-credits/segments?q=${encodeURIComponent(trimmed)}`
          : `/api/store-credits/segments`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          setSegmentError("Failed to load segments. Try again.");
          setSegmentResults([]);
          return;
        }
        const { segments } = (await res.json()) as {
          segments: StoreCreditPickerSegment[];
        };
        setSegmentResults(segments);
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setSegmentError("Failed to load segments. Try again.");
        setSegmentResults([]);
      } finally {
        setSegmentLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [segmentPickerOpen, segmentQuery]);

  const allVisibleSelected =
    pickerResults.length > 0 &&
    pickerResults.every((c) => pendingSelected.some((p) => p.id === c.id));
  const someVisibleSelected =
    !allVisibleSelected &&
    pickerResults.some((c) => pendingSelected.some((p) => p.id === c.id));

  async function handleSubmit() {
    setErrorMessage(null);
    if (selectedCustomers.length === 0 && selectedSegments.length === 0) {
      setErrorMessage(
        "Select at least one customer or segment before submitting.",
      );
      return;
    }
    setSubmitting(true);
    try {
      const body: CreateStoreCreditJobBody = {
        amount,
        currency,
        customerIds: selectedCustomers.map((c) => c.id),
        segmentIds: selectedSegments.length
          ? selectedSegments.map((s) => s.id)
          : undefined,
        note: note || undefined,
        expireDate: expireDate || undefined,
        notify,
        scheduledDate: scheduleEnabled ? scheduledDate || undefined : undefined,
        scheduledTime: scheduleEnabled ? scheduledTime || undefined : undefined,
        scheduledTimezone: scheduleEnabled
          ? scheduledTimezone || undefined
          : undefined,
        scheduledMessage: scheduleEnabled
          ? scheduledMessage || undefined
          : undefined,
      };
      const res = await fetch("/api/store-credits/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { message?: string; jobId?: string };
      if (!res.ok) {
        setErrorMessage(data.message || "Failed to create store credit job");
        return;
      }
      navigate(`/app/store-credit/${data.jobId}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <s-page heading="Issue store credit" inlineSize="base">
      <s-link slot="breadcrumb-actions" href="/app/store-credit">
        Store Credits
      </s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={handleSubmit}
        loading={submitting || undefined}
      >
        Issue store credit
      </s-button>

      <s-stack direction="block" gap="base">
        {errorMessage && (
          <s-banner tone="critical">
            <s-text>{errorMessage}</s-text>
          </s-banner>
        )}

        <s-section heading="Recipients">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-button variant="secondary" onClick={openCustomerPicker}>
                Select customers
              </s-button>
              <s-button variant="secondary" onClick={openSegmentPicker}>
                Select segments
              </s-button>
              <s-text color="subdued">
                {selectedCustomers.length === 0 &&
                selectedSegments.length === 0
                  ? "No recipients selected yet."
                  : [
                      selectedCustomers.length > 0
                        ? `${selectedCustomers.length} customer${selectedCustomers.length === 1 ? "" : "s"}`
                        : null,
                      selectedSegments.length > 0
                        ? `${selectedSegments.length} segment${selectedSegments.length === 1 ? "" : "s"}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") + " selected."}
              </s-text>
            </s-stack>

            {(selectedCustomers.length > 0 || selectedSegments.length > 0) && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "6px",
                }}
              >
                {selectedSegments.map((s) => (
                  <s-clickable-chip
                    key={s.id}
                    color="base"
                    onClick={() => removeSelectedSegment(s.id)}
                    accessibilityLabel={`Remove segment ${s.name}`}
                  >
                    Segment: {s.name} · {s.count.toLocaleString()} customer
                    {s.count === 1 ? "" : "s"} ×
                  </s-clickable-chip>
                ))}
                {selectedCustomers.map((c) => {
                  const label = c.email ? `${c.name} — ${c.email}` : c.name;
                  return (
                    <s-clickable-chip
                      key={c.id}
                      color="base"
                      onClick={() => removeSelectedCustomer(c.id)}
                      accessibilityLabel={`Remove ${label}`}
                    >
                      {label} ×
                    </s-clickable-chip>
                  );
                })}
              </div>
            )}
          </s-stack>
        </s-section>

        <s-section heading="Amount">
          <s-stack direction="block" gap="base">
            <s-grid
              gridTemplateColumns="@container (inline-size <= 600px) 1fr, 1fr 1fr"
              gap="base"
            >
              <s-number-field
                label="Amount"
                value={amount}
                min={STORE_CREDIT_RULES.minAmount}
                step={0.01}
                max={STORE_CREDIT_RULES.maxAmount}
                onChange={(event: Event) =>
                  setAmount((event.target as HTMLInputElement).value)
                }
              />

              <s-select
                label="Currency"
                value={currency}
                onChange={(event: Event) =>
                  setCurrency(
                    (event.target as HTMLSelectElement)
                      .value as CreateStoreCreditJobBody["currency"],
                  )
                }
              >
                {STORE_CREDIT_SUPPORTED_CURRENCIES.map((c) => (
                  <s-option key={c} value={c}>
                    {c}
                  </s-option>
                ))}
              </s-select>
            </s-grid>
          </s-stack>
        </s-section>

        <s-section heading="Options">
          <s-stack direction="block" gap="base">
            <s-date-field
              label="Expiration Date (optional)"
              value={expireDate}
              onChange={(event: Event) =>
                setExpireDate((event.target as HTMLInputElement).value)
              }
            />

            <s-checkbox
              label="Notify customers by email"
              checked={notify}
              onChange={(event: Event) =>
                setNotify((event.target as HTMLInputElement).checked)
              }
            />

            <s-text-area
              label="Note (only visible to you)"
              value={note}
              rows={3}
              maxLength={STORE_CREDIT_RULES.noteMaxChars}
              onInput={(event: Event) =>
                setNote((event.target as HTMLTextAreaElement).value)
              }
            />
          </s-stack>
        </s-section>

        <s-section heading="Scheduling">
          <s-stack direction="block" gap="base">
            <s-checkbox
              label="Schedule for later"
              details="When off, store credit is issued immediately."
              checked={scheduleEnabled}
              onChange={(event: Event) =>
                setScheduleEnabled((event.target as HTMLInputElement).checked)
              }
            />

            {scheduleEnabled && (
              <s-stack direction="block" gap="base">
                <s-grid
              gridTemplateColumns="@container (inline-size <= 600px) 1fr, 1fr 1fr"
              gap="base"
            >
                  <s-box>
                    <s-date-field
                      label="Send Date"
                      value={scheduledDate}
                      onChange={(event: Event) =>
                        setScheduledDate((event.target as HTMLInputElement).value)
                      }
                    />
                  </s-box>

                  <s-box>
                    <s-text-field
                      label="Send Time"
                      placeholder="HH:MM"
                      value={scheduledTime}
                      onChange={(event: Event) =>
                        setScheduledTime((event.target as HTMLInputElement).value)
                      }
                    />
                  </s-box>
                </s-grid>

                <s-select
                  label="Timezone"
                  value={scheduledTimezone}
                  onChange={(event: Event) =>
                    setScheduledTimezone(
                      (event.target as HTMLSelectElement).value,
                    )
                  }
                >
                  <s-option value="">Select timezone</s-option>
                  {timezoneLabels.map((tz) => (
                    <s-option key={tz.value} value={tz.value}>
                      {tz.label}
                    </s-option>
                  ))}
                </s-select>

                <s-text-field
                  label="Scheduled message (optional)"
                  value={scheduledMessage}
                  onChange={(event: Event) =>
                    setScheduledMessage((event.target as HTMLInputElement).value)
                  }
                />
              </s-stack>
            )}
          </s-stack>
        </s-section>

        <AppPageFooter />
      </s-stack>

      <s-modal
        id="customer-picker-modal"
        ref={pickerModalRef as never}
        heading="Select customers"
        onHide={() => setPickerOpen(false)}
      >
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Search customers"
            labelAccessibilityVisibility="exclusive"
            placeholder="Search..."
            icon="search"
            value={pickerQuery}
            onInput={(event: Event) =>
              setPickerQuery((event.target as HTMLInputElement).value)
            }
          />
          {pickerError && (
            <s-banner tone="critical">
              <s-text>{pickerError}</s-text>
            </s-banner>
          )}
          {pickerLoading && pickerResults.length === 0 ? (
            <s-stack direction="inline" alignItems="center" gap="base">
              <s-spinner size="base" accessibilityLabel="Loading customers" />
              <s-text color="subdued">Loading customers…</s-text>
            </s-stack>
          ) : pickerResults.length === 0 ? (
            <s-text color="subdued">
              {pickerQuery.trim()
                ? `No customers match "${pickerQuery.trim()}".`
                : "No customers found."}
            </s-text>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someVisibleSelected;
                      }}
                      onChange={toggleSelectAllVisible}
                      aria-label="Select all customers"
                      style={{
                        width: "16px",
                        height: "16px",
                        cursor: "pointer",
                        accentColor: "var(--p-color-bg-fill-brand)",
                      }}
                    />
                    <span>Customer</span>
                  </div>
                </s-table-header>
              </s-table-header-row>
              <s-table-body>
                {pickerResults.map((c) => {
                  const checked = pendingSelected.some((p) => p.id === c.id);
                  const label = c.email
                    ? `${c.name} — ${c.email}`
                    : c.name;
                  return (
                    <s-table-row key={c.id}>
                      <s-table-cell>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => togglePendingCustomer(c)}
                            aria-label={label}
                            style={{
                              width: "16px",
                              height: "16px",
                              cursor: "pointer",
                              accentColor: "var(--p-color-bg-fill-brand)",
                            }}
                          />
                          <span>{label}</span>
                        </div>
                      </s-table-cell>
                    </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>
          )}
        </s-stack>
        <s-button slot="secondary-actions" onClick={closeCustomerPicker}>
          Cancel
        </s-button>
        <s-button
          slot="primary-action"
          variant="primary"
          onClick={confirmCustomerSelection}
        >
          {pendingSelected.length === 0
            ? "Add"
            : `Add ${pendingSelected.length} customer${pendingSelected.length === 1 ? "" : "s"}`}
        </s-button>
      </s-modal>

      <s-modal
        id="segment-picker-modal"
        ref={segmentPickerModalRef as never}
        heading="Select segments"
        onHide={() => setSegmentPickerOpen(false)}
      >
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Search segments"
            labelAccessibilityVisibility="exclusive"
            placeholder="Search..."
            icon="search"
            value={segmentQuery}
            onInput={(event: Event) =>
              setSegmentQuery((event.target as HTMLInputElement).value)
            }
          />
          {segmentError && (
            <s-banner tone="critical">
              <s-text>{segmentError}</s-text>
            </s-banner>
          )}
          {segmentLoading && segmentResults.length === 0 ? (
            <s-stack direction="inline" alignItems="center" gap="base">
              <s-spinner size="base" accessibilityLabel="Loading segments" />
              <s-text color="subdued">Loading segments…</s-text>
            </s-stack>
          ) : segmentResults.length === 0 ? (
            <s-text color="subdued">
              {segmentQuery.trim()
                ? `No segments match "${segmentQuery.trim()}".`
                : "No segments found. Create one in Shopify admin first."}
            </s-text>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header>Segment</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {segmentResults.map((s) => {
                  const checked = pendingSegments.some((p) => p.id === s.id);
                  const countLabel = `${s.count.toLocaleString()} customer${
                    s.count === 1 ? "" : "s"
                  }`;
                  return (
                    <s-table-row key={s.id}>
                      <s-table-cell>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => togglePendingSegment(s)}
                            aria-label={`${s.name} (${countLabel})`}
                            style={{
                              width: "16px",
                              height: "16px",
                              cursor: "pointer",
                              accentColor: "var(--p-color-bg-fill-brand)",
                            }}
                          />
                          <span>
                            {s.name}{" "}
                            <s-text color="subdued">· {countLabel}</s-text>
                          </span>
                        </div>
                      </s-table-cell>
                    </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>
          )}
        </s-stack>
        <s-button slot="secondary-actions" onClick={closeSegmentPicker}>
          Cancel
        </s-button>
        <s-button
          slot="primary-action"
          variant="primary"
          onClick={confirmSegmentSelection}
        >
          {pendingSegments.length === 0
            ? "Add"
            : `Add ${pendingSegments.length} segment${pendingSegments.length === 1 ? "" : "s"}`}
        </s-button>
      </s-modal>
    </s-page>
  );
}

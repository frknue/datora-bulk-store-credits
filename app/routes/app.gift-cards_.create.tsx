import { useCallback, useEffect, useRef, useState } from "react";
import {
  redirect,
  useLoaderData,
  useNavigate,
  useOutletContext,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  CreateJobDetailsSection,
  CreateJobPlanBanner,
  CreateJobPresetSection,
  CreateJobSavePresetSection,
  CreateJobSchedulingSection,
  CreateJobSummarySection,
} from "../components/create-job-sections";
import { AppPageFooter } from "../components/app-page-footer";
import { authenticate } from "../shopify.server";
import { getPlanFromBilling } from "../services/plan.server";
import { useCreateJobForm } from "../lib/hooks/use-create-job-form";
import { loadCreateJobPageData } from "../lib/services/create-job-page.server";
import { createJobCodeLengthOptions } from "../lib/utils/create-job";
import type { AppOutletContext } from "../lib/types/app";
import type { LoaderFunctionArgs } from "react-router";
import type { StoreCreditPickerCustomer } from "./api.store-credits.customers";
import type { StoreCreditPickerSegment } from "./api.store-credits.segments";

const CREATE_JOB_SAVE_BAR = "create-gift-card-job-save-bar";

type SelectedCustomer = Pick<StoreCreditPickerCustomer, "id" | "name" | "email">;
type SelectedSegment = Pick<StoreCreditPickerSegment, "id" | "name" | "count">;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const plan = await getPlanFromBilling(admin, billing, session.shop);
  if (plan.maxGiftCards === 0) {
    throw redirect("/app/subscriptions");
  }
  const url = new URL(request.url);
  const extensionCustomerIds = url.searchParams.get("customerIds") || "";
  return loadCreateJobPageData(session.shop, extensionCustomerIds);
};

export default function CreateJob() {
  const { presets, totalGiftCardsCreated, extensionCustomerIds } =
    useLoaderData<typeof loader>();
  const {
    subscriptionPlan,
    shopCurrency,
    shopTimezoneOffset,
    shopMetadataLoaded,
  } =
    useOutletContext<AppOutletContext>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const displayCurrency = shopCurrency || "USD";
  const planMaxAmount = subscriptionPlan.maxGiftCards;

  const hasExtensionCustomers = extensionCustomerIds.length > 0;
  const [sendByEmail, setSendByEmail] = useState(false);

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

  const pickedCustomerIds = selectedCustomers.map((c) => c.id);
  const pickedSegmentIds = selectedSegments.map((s) => s.id);
  const pickedSegmentRecipientCount = selectedSegments.reduce(
    (sum, s) => sum + s.count,
    0,
  );

  // When BOTH customers and segments are picked, the local estimate
  // (customers.length + sum(segments.count)) double-counts any customer that
  // also belongs to a picked segment. Resolve the real deduped count
  // server-side so the summary, banner, and synced count field all match
  // what the create-job endpoint will actually persist.
  const [resolvedRecipientCount, setResolvedRecipientCount] = useState<
    number | null
  >(null);
  const customerKey = pickedCustomerIds.join(",");
  const segmentKey = pickedSegmentIds.join(",");
  useEffect(() => {
    if (
      !sendByEmail ||
      hasExtensionCustomers ||
      pickedCustomerIds.length === 0 ||
      pickedSegmentIds.length === 0
    ) {
      setResolvedRecipientCount(null);
      return;
    }
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      try {
        const res = await fetch("/api/recipients-count", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerIds: pickedCustomerIds,
            segmentIds: pickedSegmentIds,
          }),
          signal: controller.signal,
        });
        if (!res.ok) return;
        const { count } = (await res.json()) as { count: number };
        setResolvedRecipientCount(count);
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        // Fall back silently to the local estimate; the server will use the
        // truth at job-creation time anyway.
      }
    }, 400);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendByEmail, hasExtensionCustomers, customerKey, segmentKey]);

  const {
    values,
    initialValues,
    errors,
    submitting,
    submitError,
    hasCustomerIds,
    recipientCount,
    isUnlimited,
    isAtLimit,
    remaining,
    handleSubmit,
    reset: resetForm,
    timezoneOptions,
    handlePresetChange,
    setCount,
    setValue,
    setPrefix,
    setPostfix,
    setCodeLength,
    setNote,
    setExpireDate,
    setSavePreset,
    setPresetName,
    setScheduledSend,
    setScheduledDate,
    setScheduledTime,
    setScheduledTimezone,
    setScheduledMessage,
  } = useCreateJobForm({
    presets,
    extensionCustomerIds,
    planMaxAmount,
    totalGiftCardsCreated,
    shopCurrency,
    shopTimezoneOffset,
    sendByEmail,
    pickedCustomerIds,
    pickedSegmentIds,
    pickedSegmentRecipientCount,
    resolvedRecipientCount,
    saveBarId: CREATE_JOB_SAVE_BAR,
  });

  // 1 recipient = 1 gift card. When sending by email, keep the form's count
  // synced to the recipient count so the summary section and any preset save
  // both reflect the correct number.
  useEffect(() => {
    if (!hasCustomerIds) return;
    const target = String(recipientCount);
    if (values.count !== target) setCount(target);
  }, [hasCustomerIds, recipientCount, values.count, setCount]);

  const {
    count,
    value,
    prefix,
    postfix,
    codeLength,
    note,
    expireDate,
    selectedPreset,
    savePreset,
    presetName,
    scheduledSend,
    scheduledDate,
    scheduledTime,
    scheduledTimezone,
    scheduledMessage,
  } = values;

  const isDirty =
    values.count !== initialValues.count ||
    values.value !== initialValues.value ||
    values.prefix !== initialValues.prefix ||
    values.postfix !== initialValues.postfix ||
    values.codeLength !== initialValues.codeLength ||
    values.note !== initialValues.note ||
    values.expireDate !== initialValues.expireDate ||
    values.selectedPreset !== initialValues.selectedPreset ||
    values.savePreset !== initialValues.savePreset ||
    values.presetName !== initialValues.presetName ||
    values.scheduledSend !== initialValues.scheduledSend ||
    values.scheduledDate !== initialValues.scheduledDate ||
    values.scheduledTime !== initialValues.scheduledTime ||
    values.scheduledTimezone !== initialValues.scheduledTimezone ||
    values.scheduledMessage !== initialValues.scheduledMessage ||
    sendByEmail ||
    selectedCustomers.length > 0 ||
    selectedSegments.length > 0;

  useEffect(() => {
    if (isDirty) shopify.saveBar.show(CREATE_JOB_SAVE_BAR);
    else shopify.saveBar.hide(CREATE_JOB_SAVE_BAR);
  }, [isDirty, shopify]);

  useEffect(() => {
    return () => {
      shopify.saveBar.hide(CREATE_JOB_SAVE_BAR);
    };
  }, [shopify]);

  const handleBreadcrumbClick = useCallback(async () => {
    try {
      await shopify.saveBar.leaveConfirmation();
    } catch {
      return;
    }
    navigate("/app");
  }, [shopify, navigate]);

  const handleDiscard = useCallback(() => {
    resetForm();
    setSendByEmail(false);
    setSelectedCustomers([]);
    setSelectedSegments([]);
  }, [resetForm]);

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

  // Debounced server search while the customer picker is open.
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

  // Debounced server search for segments.
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

  return (
    <s-page heading="Create Gift Cards" inlineSize="base">
      <s-button
        slot="breadcrumb-actions"
        variant="tertiary"
        onClick={handleBreadcrumbClick}
      >
        Dashboard
      </s-button>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={handleSubmit}
        disabled={
          submitting ||
          isAtLimit ||
          (sendByEmail &&
            !hasExtensionCustomers &&
            selectedCustomers.length === 0 &&
            selectedSegments.length === 0) ||
          undefined
        }
        loading={submitting || undefined}
      >
        Create gift cards
      </s-button>

      <ui-save-bar id={CREATE_JOB_SAVE_BAR}>
        <button
          {...{ variant: "primary", loading: submitting || undefined }}
          onClick={handleSubmit}
          disabled={
            submitting ||
            isAtLimit ||
            (sendByEmail &&
              !hasExtensionCustomers &&
              selectedCustomers.length === 0 &&
              selectedSegments.length === 0) ||
            undefined
          }
        >
          Create gift cards
        </button>
        <button onClick={handleDiscard}>Discard</button>
      </ui-save-bar>

      <s-stack direction="block" gap="base">
        <s-section>
          <s-stack direction="block" gap="base">
            {/* Single banner by priority — BFS 4.3.4 forbids stacked banners
                inside one card. critical > warning > info; the plan banner
                is the default informational fallback. */}
            {submitError ? (
              <s-banner tone="critical">{submitError}</s-banner>
            ) : !shopMetadataLoaded ? (
              <s-banner tone="warning">
                We couldn&apos;t load your shop currency and timezone. Currency is
                shown with a fallback for display only, and scheduled email jobs
                require manual timezone selection until shop metadata loads again.
              </s-banner>
            ) : (
              <CreateJobPlanBanner
                planName={subscriptionPlan.name}
                isUnlimited={isUnlimited}
                isAtLimit={isAtLimit}
                remaining={remaining}
                planMaxAmount={planMaxAmount}
              />
            )}

            {hasCustomerIds && (
              <s-paragraph color="subdued">
                <strong>{recipientCount} customer(s)</strong> selected. Gift
                cards will be sent to these customers by email.
              </s-paragraph>
            )}

            {subscriptionPlan.presets && presets.length > 0 && (
              <CreateJobPresetSection
                presets={presets}
                selectedPreset={selectedPreset}
                onPresetChange={handlePresetChange}
              />
            )}

            <CreateJobDetailsSection
              count={count}
              value={value}
              prefix={prefix}
              postfix={postfix}
              codeLength={codeLength}
              note={note}
              expireDate={expireDate}
              shopCurrency={displayCurrency}
              isUnlimited={isUnlimited}
              isAtLimit={isAtLimit}
              remaining={remaining}
              errors={errors}
              hideCount={hasCustomerIds}
              onCountChange={setCount}
              onValueChange={setValue}
              onPrefixChange={setPrefix}
              onPostfixChange={setPostfix}
              onCodeLengthChange={setCodeLength}
              onNoteChange={setNote}
              onExpireDateChange={setExpireDate}
              codeLengthOptions={createJobCodeLengthOptions}
            />

            {subscriptionPlan.presets && (
              <CreateJobSavePresetSection
                savePreset={savePreset}
                presetName={presetName}
                presetNameError={errors.presetName}
                onSavePresetChange={setSavePreset}
                onPresetNameChange={setPresetName}
              />
            )}

            {count && value && (
              <CreateJobSummarySection
                count={count}
                value={value}
                shopCurrency={displayCurrency}
              />
            )}
          </s-stack>
        </s-section>

        {!hasExtensionCustomers && (
          <s-section heading="Recipients">
            <s-stack direction="block" gap="base">
              <s-checkbox
                label="Send by email to customers"
                details="When off, gift cards are generated as a batch with no recipients."
                checked={sendByEmail}
                disabled={!subscriptionPlan.extension || undefined}
                onChange={(event: Event) =>
                  setSendByEmail((event.target as HTMLInputElement).checked)
                }
              />

              {!subscriptionPlan.extension && (
                <s-banner tone="info">
                  Email delivery is available on the Basic plan and above.{" "}
                  <s-link href="/app/subscriptions">Upgrade your plan</s-link>{" "}
                  to send gift cards by email.
                </s-banner>
              )}

              {sendByEmail && subscriptionPlan.extension && (
                <s-stack direction="block" gap="base">
                  <s-stack
                    direction="inline"
                    gap="base"
                    alignItems="center"
                  >
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

                  {(selectedCustomers.length > 0 ||
                    selectedSegments.length > 0) && (
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
                          Segment: {s.name} · {s.count.toLocaleString()}{" "}
                          customer{s.count === 1 ? "" : "s"} ×
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
              )}
            </s-stack>
          </s-section>
        )}

        {hasCustomerIds && (
          <CreateJobSchedulingSection
            scheduledSend={scheduledSend}
            scheduledDate={scheduledDate}
            scheduledTime={scheduledTime}
            scheduledTimezone={scheduledTimezone}
            scheduledMessage={scheduledMessage}
            timezoneOptions={timezoneOptions}
            errors={errors}
            onScheduledSendChange={setScheduledSend}
            onScheduledDateChange={setScheduledDate}
            onScheduledTimeChange={setScheduledTime}
            onScheduledTimezoneChange={setScheduledTimezone}
            onScheduledMessageChange={setScheduledMessage}
          />
        )}

        <AppPageFooter />
      </s-stack>

      <s-modal
        id="gift-card-customer-picker-modal"
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
                  const label = c.email ? `${c.name} — ${c.email}` : c.name;
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
        id="gift-card-segment-picker-modal"
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

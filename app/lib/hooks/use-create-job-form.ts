import { useAppBridge } from "@shopify/app-bridge-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { timezoneLabels } from "../utils/timezone";
import {
  buildCreateJobRequestBody,
  getCreateJobInitialValues,
  getCustomerIdsList,
  getPresetFormValues,
  validateCreateJobForm,
  type CreateJobFormValues,
  type CreateJobPreset,
} from "../utils/create-job";
import type { CreateJobErrors } from "../types/create-job";

interface CreateJobFormOptions {
  presets: CreateJobPreset[];
  extensionCustomerIds: string;
  planMaxAmount: number;
  totalGiftCardsCreated: number;
  shopCurrency: string | null;
  shopTimezoneOffset: string | null;
  sendByEmail: boolean;
  pickedCustomerIds: string[];
  pickedSegmentIds: string[];
  pickedSegmentRecipientCount: number;
  /**
   * Server-resolved deduped recipient count. When provided (only when both
   * customers and segments are picked together), overrides the local
   * estimate so the displayed count matches what the server will actually
   * create.
   */
  resolvedRecipientCount: number | null;
}

function getFormErrors(
  values: CreateJobFormValues,
  hasCustomerIds: boolean,
  isUnlimited: boolean,
  remaining: number,
) {
  return validateCreateJobForm(values, {
    hasCustomerIds,
    isUnlimited,
    remaining,
  });
}

export function useCreateJobForm({
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
}: CreateJobFormOptions) {
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialValues = getCreateJobInitialValues(searchParams, shopTimezoneOffset);
  const hasExtensionCustomers = extensionCustomerIds.length > 0;
  const extensionCustomerIdsList = useMemo(
    () =>
      hasExtensionCustomers ? getCustomerIdsList(extensionCustomerIds) : [],
    [extensionCustomerIds, hasExtensionCustomers],
  );
  // The extension flow and the in-app "Send by email" flow are mutually
  // exclusive. The UI hides the in-app pickers when extension IDs are present,
  // so we just pick the active source here.
  const customerIdsList = hasExtensionCustomers
    ? extensionCustomerIdsList
    : sendByEmail
      ? pickedCustomerIds
      : [];
  const segmentIdsList = sendByEmail && !hasExtensionCustomers ? pickedSegmentIds : [];
  const segmentRecipientCount =
    sendByEmail && !hasExtensionCustomers ? pickedSegmentRecipientCount : 0;
  const estimatedRecipientCount = customerIdsList.length + segmentRecipientCount;
  // Prefer the server-resolved deduped count when available, since the
  // estimate double-counts customers that are also members of a picked
  // segment. Fall back to the estimate when there's no overlap risk
  // (one source picked, or the resolved count hasn't loaded yet).
  const recipientCount =
    resolvedRecipientCount !== null && resolvedRecipientCount >= 0
      ? resolvedRecipientCount
      : estimatedRecipientCount;
  const hasCustomerIds = recipientCount > 0;
  const isUnlimited = planMaxAmount === -1;
  const remaining = isUnlimited
    ? Infinity
    : Math.max(0, planMaxAmount - totalGiftCardsCreated);
  const isAtLimit = !isUnlimited && remaining <= 0;
  const [values, setValues] = useState(initialValues);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<CreateJobErrors>({});

  const updateValue = useCallback(
    <K extends keyof CreateJobFormValues>(field: K, value: CreateJobFormValues[K]) => {
      setValues((currentValues) => ({ ...currentValues, [field]: value }));
    },
    [],
  );

  const handlePresetChange = useCallback(
    (presetId: string) => {
      updateValue("selectedPreset", presetId);
      if (!presetId) return;

      const preset = presets.find((item) => item.id === presetId);
      if (!preset) return;

      const presetValues = getPresetFormValues(preset);
      setValues((currentValues) => ({
        ...currentValues,
        ...presetValues,
        selectedPreset: presetId,
      }));
    },
    [presets, updateValue],
  );

  const validate = useCallback(() => {
    // For email-by-recipient jobs the work size is the number of recipients,
    // not the form's "count" field — validate the plan limit against that.
    const valuesForValidation = hasCustomerIds
      ? { ...values, count: String(recipientCount) }
      : values;
    return getFormErrors(valuesForValidation, hasCustomerIds, isUnlimited, remaining);
  }, [values, hasCustomerIds, recipientCount, isUnlimited, remaining]);

  const handleSubmit = useCallback(async () => {
    const validationErrors = validate();
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    setSubmitting(true);
    shopify.loading(true);

    try {
      const body = buildCreateJobRequestBody(values, {
        customerIdsList,
        hasCustomerIds,
        segmentIdsList,
        segmentRecipientCount,
        shopCurrency: shopCurrency || undefined,
      });

      const response = await fetch("/api/jobs/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        shopify.toast.show("Create failed", { isError: true });
        return;
      }

      shopify.toast.show("Job created");
      navigate("/app/gift-cards");
    } catch (error) {
      console.error("Error creating job:", error);
      shopify.toast.show("Create failed", { isError: true });
    } finally {
      setSubmitting(false);
      shopify.loading(false);
    }
  }, [
    validate,
    shopify,
    values,
    customerIdsList,
    hasCustomerIds,
    segmentIdsList,
    segmentRecipientCount,
    shopCurrency,
    navigate,
  ]);

  const handleSubmitRef = useRef(handleSubmit);
  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);

  const stableHandleSubmit = useCallback(() => {
    handleSubmitRef.current();
  }, []);

  const timezoneOptions = useMemo(
    () => timezoneLabels.map((tz) => ({ label: tz.label, value: tz.value })),
    [],
  );

  return {
    values,
    errors,
    submitting,
    hasCustomerIds,
    customerIdsList,
    recipientCount,
    isUnlimited,
    isAtLimit,
    remaining,
    handleSubmit: stableHandleSubmit,
    timezoneOptions,
    handlePresetChange,
    setCount: (value: string) => updateValue("count", value),
    setValue: (value: string) => updateValue("value", value),
    setPrefix: (value: string) => updateValue("prefix", value),
    setPostfix: (value: string) => updateValue("postfix", value),
    setCodeLength: (value: string) => updateValue("codeLength", value),
    setNote: (value: string) => updateValue("note", value),
    setExpireDate: (value: string) => updateValue("expireDate", value),
    setSavePreset: (value: boolean) => updateValue("savePreset", value),
    setPresetName: (value: string) => updateValue("presetName", value),
    setScheduledSend: (value: boolean) => updateValue("scheduledSend", value),
    setScheduledDate: (value: string) => updateValue("scheduledDate", value),
    setScheduledTime: (value: string) => updateValue("scheduledTime", value),
    setScheduledTimezone: (value: string) => updateValue("scheduledTimezone", value),
    setScheduledMessage: (value: string) => updateValue("scheduledMessage", value),
  };
}

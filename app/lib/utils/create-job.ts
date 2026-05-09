import {
  CREATE_JOB_RULES,
  buildCreateJobRequestBody as buildSharedCreateJobRequestBody,
  getCreateJobCodeLengthOptions,
  validateCreateJobInput,
  type BuildCreateJobRequestBodyOptions,
  type CreateJobValidationInput,
  type ValidateCreateJobInputOptions,
} from "../../../shared/create-job";
import { formatTimezoneOffset } from "./timezone";

export interface CreateJobFormValues extends CreateJobValidationInput {
  count: string;
  value: string;
  prefix: string;
  postfix: string;
  codeLength: string;
  note: string;
  expireDate: string;
  selectedPreset: string;
  savePreset: boolean;
  presetName: string;
  scheduledSend: boolean;
  scheduledDate: string;
  scheduledTime: string;
  scheduledTimezone: string;
  scheduledMessage: string;
}

export interface CreateJobPreset {
  id: string;
  name: string;
  count: number;
  value: number;
  prefix?: string | null;
  postfix?: string | null;
  codeLength?: number | null;
  note?: string | null;
}

export const createJobCodeLengthOptions = getCreateJobCodeLengthOptions();

export function getCreateJobInitialValues(
  searchParams: URLSearchParams,
  shopTimezoneOffset: string | null,
): CreateJobFormValues {
  const scheduledDate = searchParams.get("scheduledDate") || "";
  const scheduledTime = searchParams.get("scheduledTime") || "";
  const scheduledTimezoneFromSearch = searchParams.get("scheduledTimezone");
  const scheduledTimezone =
    scheduledTimezoneFromSearch ||
    (shopTimezoneOffset ? formatTimezoneOffset(shopTimezoneOffset) : "");
  const scheduledMessage = searchParams.get("scheduledMessage") || "";
  const scheduledSend = Boolean(scheduledDate || scheduledTime || scheduledMessage);

  return {
    count: searchParams.get("count") || "",
    value: searchParams.get("value") || "",
    prefix: searchParams.get("prefix") || "",
    postfix: searchParams.get("postfix") || "",
    codeLength:
      searchParams.get("codeLength") || String(CREATE_JOB_RULES.codeLengthDefault),
    note: searchParams.get("note") || "",
    expireDate: searchParams.get("expireDate") || "",
    selectedPreset: "",
    savePreset: false,
    presetName: "",
    scheduledSend,
    scheduledDate,
    scheduledTime,
    scheduledTimezone,
    scheduledMessage,
  };
}

export function getCustomerIdsList(extensionCustomerIds: string): string[] {
  return extensionCustomerIds.split(",").filter(Boolean);
}

export function getPresetFormValues(
  preset: CreateJobPreset,
): Pick<
  CreateJobFormValues,
  "count" | "value" | "prefix" | "postfix" | "codeLength" | "note"
> {
  return {
    count: String(preset.count),
    value: String(preset.value),
    prefix: preset.prefix || "",
    postfix: preset.postfix || "",
    codeLength: String(preset.codeLength || CREATE_JOB_RULES.codeLengthDefault),
    note: preset.note || "",
  };
}

export function validateCreateJobForm(
  values: CreateJobFormValues,
  options: ValidateCreateJobInputOptions,
): Record<string, string> {
  return validateCreateJobInput(values, options);
}

export function buildCreateJobRequestBody(
  values: CreateJobFormValues,
  options: BuildCreateJobRequestBodyOptions,
) {
  return buildSharedCreateJobRequestBody(values, options);
}

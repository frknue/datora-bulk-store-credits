export const CREATE_JOB_RULES = {
  countMaxVolume: 75000,
  prefixMaxChars: 4,
  postfixMaxChars: 4,
  prefixRegex: /^[a-zA-Z0-9]+$/,
  postfixRegex: /^[a-zA-Z0-9]+$/,
  valueMax: 10000000,
  noteMaxChars: 100,
  codeLengthDefault: 16,
  codeLengthMin: 8,
  codeLengthMax: 20,
  presetMaxChars: 50,
  scheduledMessageMaxChars: 160,
} as const;

export interface CreateJobBody {
  value: number;
  count: number;
  note?: string;
  prefix?: string;
  postfix?: string;
  codeLength?: number;
  savePreset?: boolean;
  presetName?: string;
  expireDate?: string;
  customerIds?: string[] | string;
  segmentIds?: string[];
  scheduledDate?: string;
  scheduledTime?: string;
  scheduledMessage?: string;
  scheduledTimezone?: string;
  giftCardCurrency?: string;
}

export interface CreateJobValidationInput {
  value?: string | number | null;
  count?: string | number | null;
  note?: string | null;
  prefix?: string | null;
  postfix?: string | null;
  codeLength?: string | number | null;
  savePreset?: boolean;
  presetName?: string | null;
  expireDate?: string | null;
  scheduledSend?: boolean;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  scheduledMessage?: string | null;
  scheduledTimezone?: string | null;
}

export interface ValidateCreateJobInputOptions {
  hasCustomerIds: boolean;
  isUnlimited: boolean;
  remaining: number;
}

export interface BuildCreateJobRequestBodyOptions {
  customerIdsList: string[];
  hasCustomerIds: boolean;
  segmentIdsList?: string[];
  segmentRecipientCount?: number;
  shopCurrency?: string;
}

export type CreateJobValidationErrors = Partial<
  Record<keyof CreateJobValidationInput, string>
>;

const integerFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

function formatWholeNumber(value: number): string {
  return integerFormatter.format(value);
}

function parseNumericInput(value: string | number | null | undefined): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    return Number(value);
  }

  return Number.NaN;
}

export function getCreateJobCodeLengthOptions(): Array<{
  label: string;
  value: string;
}> {
  return Array.from(
    {
      length: CREATE_JOB_RULES.codeLengthMax - CREATE_JOB_RULES.codeLengthMin + 1,
    },
    (_, index) => {
      const value = CREATE_JOB_RULES.codeLengthMin + index;
      return { label: String(value), value: String(value) };
    },
  );
}

export function validateCreateJobInput(
  input: CreateJobValidationInput,
  { hasCustomerIds, isUnlimited, remaining }: ValidateCreateJobInputOptions,
): CreateJobValidationErrors {
  const errors: CreateJobValidationErrors = {};
  const countNumber = parseNumericInput(input.count);
  const valueNumber = parseNumericInput(input.value);
  const codeLengthNumber =
    input.codeLength === undefined || input.codeLength === null || input.codeLength === ""
      ? CREATE_JOB_RULES.codeLengthDefault
      : parseNumericInput(input.codeLength);

  if (
    input.count === undefined ||
    input.count === null ||
    input.count === "" ||
    Number.isNaN(countNumber) ||
    countNumber < 1
  ) {
    errors.count = "Count must be at least 1";
  } else if (countNumber > CREATE_JOB_RULES.countMaxVolume) {
    errors.count = `Count cannot exceed ${formatWholeNumber(CREATE_JOB_RULES.countMaxVolume)}`;
  } else if (!isUnlimited && countNumber > remaining) {
    errors.count = `Exceeds your remaining monthly limit of ${formatWholeNumber(remaining)}`;
  }

  if (
    input.value === undefined ||
    input.value === null ||
    input.value === "" ||
    Number.isNaN(valueNumber) ||
    valueNumber <= 0
  ) {
    errors.value = "Value must be greater than 0";
  } else if (valueNumber > CREATE_JOB_RULES.valueMax) {
    errors.value = `Value cannot exceed ${formatWholeNumber(CREATE_JOB_RULES.valueMax)}`;
  }

  if (input.prefix && !CREATE_JOB_RULES.prefixRegex.test(input.prefix)) {
    errors.prefix = "Prefix must be alphanumeric only";
  }

  if (input.prefix && input.prefix.length > CREATE_JOB_RULES.prefixMaxChars) {
    errors.prefix = `Prefix cannot exceed ${CREATE_JOB_RULES.prefixMaxChars} characters`;
  }

  if (input.postfix && !CREATE_JOB_RULES.postfixRegex.test(input.postfix)) {
    errors.postfix = "Postfix must be alphanumeric only";
  }

  if (input.postfix && input.postfix.length > CREATE_JOB_RULES.postfixMaxChars) {
    errors.postfix = `Postfix cannot exceed ${CREATE_JOB_RULES.postfixMaxChars} characters`;
  }

  if (input.note && input.note.length > CREATE_JOB_RULES.noteMaxChars) {
    errors.note = `Note cannot exceed ${CREATE_JOB_RULES.noteMaxChars} characters`;
  }

  if (
    Number.isNaN(codeLengthNumber) ||
    codeLengthNumber < CREATE_JOB_RULES.codeLengthMin ||
    codeLengthNumber > CREATE_JOB_RULES.codeLengthMax
  ) {
    errors.codeLength = `Code length must be between ${CREATE_JOB_RULES.codeLengthMin} and ${CREATE_JOB_RULES.codeLengthMax}`;
  } else {
    const prefixLen = input.prefix ? input.prefix.length : 0;
    const postfixLen = input.postfix ? input.postfix.length : 0;
    const randomPartLen = codeLengthNumber - prefixLen - postfixLen;

    if (randomPartLen <= 0) {
      errors.codeLength =
        "Code length must be greater than prefix and postfix length combined";
    } else if (!Number.isNaN(countNumber) && countNumber > 0) {
      const totalPossibleCodes = Math.pow(36, randomPartLen);
      const maxSafeCount = Math.floor(totalPossibleCodes * 0.5);
      if (countNumber > maxSafeCount) {
        errors.count = `Too many cards for the current code settings. With ${randomPartLen} random character${randomPartLen === 1 ? "" : "s"}, only ${formatWholeNumber(maxSafeCount)} unique codes can be safely generated. Increase the code length or remove the prefix/postfix.`;
      }
    }
  }

  if (input.expireDate) {
    const expireDate = new Date(input.expireDate);
    if (Number.isNaN(expireDate.getTime()) || expireDate <= new Date()) {
      errors.expireDate = "Expire date must be in the future";
    }
  }

  if (input.savePreset && !input.presetName?.trim()) {
    errors.presetName = "Preset name is required";
  }

  if (
    input.savePreset &&
    input.presetName &&
    input.presetName.length > CREATE_JOB_RULES.presetMaxChars
  ) {
    errors.presetName = `Preset name cannot exceed ${CREATE_JOB_RULES.presetMaxChars} characters`;
  }

  // Only require scheduling fields when the user has explicitly opted in via
  // the "Scheduled send out" toggle — `scheduledTimezone` is auto-populated
  // from the shop's offset and would otherwise trigger required-field errors
  // even when scheduling is off (the date/time fields are hidden in that
  // state, so those errors would be silent).
  if (hasCustomerIds && input.scheduledSend) {
    if (!input.scheduledDate) errors.scheduledDate = "Scheduled date is required";
    if (!input.scheduledTime) errors.scheduledTime = "Scheduled time is required";
    if (!input.scheduledTimezone) {
      errors.scheduledTimezone = "Scheduled timezone is required";
    }
  }

  if (
    input.scheduledMessage &&
    input.scheduledMessage.length > CREATE_JOB_RULES.scheduledMessageMaxChars
  ) {
    errors.scheduledMessage = `Message cannot exceed ${CREATE_JOB_RULES.scheduledMessageMaxChars} characters`;
  }

  return errors;
}

export function getFirstCreateJobValidationError(
  errors: CreateJobValidationErrors,
): string | null {
  for (const value of Object.values(errors)) {
    if (value) {
      return value;
    }
  }

  return null;
}

export function buildCreateJobRequestBody(
  input: CreateJobValidationInput,
  {
    customerIdsList,
    hasCustomerIds,
    segmentIdsList = [],
    segmentRecipientCount = 0,
    shopCurrency,
  }: BuildCreateJobRequestBodyOptions,
): CreateJobBody {
  const codeLength =
    input.codeLength === undefined || input.codeLength === null || input.codeLength === ""
      ? CREATE_JOB_RULES.codeLengthDefault
      : parseNumericInput(input.codeLength);

  const body: CreateJobBody = {
    count: parseNumericInput(input.count),
    value: parseNumericInput(input.value),
    codeLength,
  };

  if (shopCurrency) {
    body.giftCardCurrency = shopCurrency;
  }

  if (input.prefix) body.prefix = input.prefix;
  if (input.postfix) body.postfix = input.postfix;
  if (input.note) body.note = input.note;
  if (input.expireDate) body.expireDate = input.expireDate;

  if (input.savePreset) {
    body.savePreset = true;
    body.presetName = input.presetName || "";
  }

  if (hasCustomerIds || segmentIdsList.length > 0) {
    body.customerIds = customerIdsList;
    if (segmentIdsList.length > 0) body.segmentIds = segmentIdsList;
    // For email jobs, the true work size is the number of recipients. The
    // segment piece is an estimate; the server recomputes after resolving
    // segments to customer IDs at job-creation time.
    body.count = customerIdsList.length + segmentRecipientCount;
    if (input.scheduledSend) {
      body.scheduledDate = input.scheduledDate || undefined;
      body.scheduledTime = input.scheduledTime || undefined;
      body.scheduledTimezone = input.scheduledTimezone || undefined;
      if (input.scheduledMessage) {
        body.scheduledMessage = input.scheduledMessage;
      }
    }
  }

  return body;
}

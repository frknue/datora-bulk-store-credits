export const STORE_CREDIT_SUPPORTED_CURRENCIES = [
  "EUR",
  "USD",
  "GBP",
  "CAD",
  "AUD",
  "JPY",
] as const;

export type StoreCreditCurrency =
  (typeof STORE_CREDIT_SUPPORTED_CURRENCIES)[number];

export const STORE_CREDIT_RULES = {
  minAmount: 0.01,
  maxAmount: 100_000,
  noteMaxChars: 500,
  maxRecipientsPerJob: 10_000,
} as const;

export interface CreateStoreCreditJobBody {
  amount: string;
  currency: StoreCreditCurrency;
  customerIds: string | string[];
  segmentIds?: string[];
  note?: string;
  expireDate?: string;
  notify?: boolean;
  scheduledDate?: string;
  scheduledTime?: string;
  scheduledTimezone?: string;
  scheduledMessage?: string;
}

export function isSupportedStoreCreditCurrency(
  value: string,
): value is StoreCreditCurrency {
  return (STORE_CREDIT_SUPPORTED_CURRENCIES as readonly string[]).includes(
    value,
  );
}

export interface StoreCreditValidationError {
  field: string;
  message: string;
}

export function validateCreateStoreCreditJobInput(
  input: CreateStoreCreditJobBody,
): StoreCreditValidationError[] {
  const errors: StoreCreditValidationError[] = [];

  const amountNum = Number(input.amount);
  if (!input.amount || Number.isNaN(amountNum)) {
    errors.push({ field: "amount", message: "Amount is required" });
  } else if (amountNum < STORE_CREDIT_RULES.minAmount) {
    errors.push({
      field: "amount",
      message: `Amount must be at least ${STORE_CREDIT_RULES.minAmount}`,
    });
  } else if (amountNum > STORE_CREDIT_RULES.maxAmount) {
    errors.push({
      field: "amount",
      message: `Amount must be at most ${STORE_CREDIT_RULES.maxAmount}`,
    });
  }

  if (!input.currency || !isSupportedStoreCreditCurrency(input.currency)) {
    errors.push({
      field: "currency",
      message: "Unsupported currency",
    });
  }

  const customerIdList = Array.isArray(input.customerIds)
    ? input.customerIds
    : (input.customerIds || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
  const segmentIdList = Array.isArray(input.segmentIds)
    ? input.segmentIds.filter(Boolean)
    : [];

  if (customerIdList.length === 0 && segmentIdList.length === 0) {
    errors.push({
      field: "customerIds",
      message: "At least one recipient is required",
    });
  } else if (customerIdList.length > STORE_CREDIT_RULES.maxRecipientsPerJob) {
    errors.push({
      field: "customerIds",
      message: `No more than ${STORE_CREDIT_RULES.maxRecipientsPerJob} recipients per job`,
    });
  }

  if (input.note && input.note.length > STORE_CREDIT_RULES.noteMaxChars) {
    errors.push({
      field: "note",
      message: `Note must be ${STORE_CREDIT_RULES.noteMaxChars} characters or fewer`,
    });
  }

  if (input.expireDate) {
    const expireDate = new Date(input.expireDate);
    if (Number.isNaN(expireDate.getTime()) || expireDate <= new Date()) {
      errors.push({
        field: "expireDate",
        message: "Expire date must be in the future",
      });
    }
  }

  const schedulingRequested = Boolean(
    input.scheduledDate ||
      input.scheduledTime ||
      input.scheduledTimezone ||
      input.scheduledMessage,
  );
  if (schedulingRequested) {
    if (!input.scheduledDate) {
      errors.push({
        field: "scheduledDate",
        message: "Scheduled date is required",
      });
    }
    if (!input.scheduledTime) {
      errors.push({
        field: "scheduledTime",
        message: "Scheduled time is required",
      });
    }
    if (!input.scheduledTimezone) {
      errors.push({
        field: "scheduledTimezone",
        message: "Scheduled timezone is required",
      });
    }
  }

  return errors;
}

export type { CreateJobBody } from "../../../shared/create-job";

export interface CreateJobData {
  id: string;
  note?: string;
  count: number;
  value: number;
  shopName: string;
  userId: bigint | number;
  status: string;
  createdAt: Date;
  expireDate?: string | null;
  prefix?: string;
  postfix?: string;
  codeLength?: number;
  subscriptionPlanId?: number;
  scheduledTime?: string;
  scheduledDate?: string;
  scheduledTimezone?: string;
  scheduledTimestamp?: string;
  scheduledMessage?: string;
  customerIds?: string | null;
  giftCardCurrency?: string;
}

export interface GiftCard {
  id: number;
  code: string;
  last_characters: string;
  balance: string;
  currency: string;
  value: number;
  note?: string;
  expires_on?: string;
  disabled_at?: string;
  status: string;
  created_at: string;
}

export interface JobProgress {
  jobId: string;
  done: number;
  total: number;
  status: string;
}

export type UsageRefreshProgressStatus = "queued" | "processing" | "completed" | "failed";

export interface UsageRefreshProgress {
  status: UsageRefreshProgressStatus;
  done: number;
  total: number;
  error?: string;
}

export interface UsageMetrics {
  totalCards: number;
  totalInitialValue: number;
  totalCurrentBalance: number;
  totalRedeemed: number;
  redemptionRate: number;
  fullBalance: number;
  partialBalance: number;
  emptyBalance: number;
  enabled: number;
  disabled: number;
  expired: number;
}

export interface GiftCardUsageRecord {
  giftCardId: string;
  lastCharacters: string;
  initialValue: number;
  currentBalance: number;
  amountRedeemed: number;
  status: string;
  balanceStatus: string;
}

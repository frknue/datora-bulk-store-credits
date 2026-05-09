export interface DashboardJob {
  id: string;
  count: number;
  done: number;
  value: number;
  status: string;
  createdAt: string | Date;
  finishedAt?: string | Date | null;
  prefix?: string | null;
  postfix?: string | null;
  codeLength?: number | null;
  note?: string | null;
  expireDate?: string | null;
  customerIds?: string | null;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  scheduledTimezone?: string | null;
  scheduledMessage?: string | null;
  subscriptionPlanId?: number | null;
  errorMessage?: string | null;
  giftCardCurrency?: string | null;
  deactivatedAt?: string | Date | null;
}

export interface JobDetailsGiftCard {
  id?: number;
  code: string;
}
export type JobDetailsPageJob = DashboardJob;

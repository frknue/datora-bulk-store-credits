interface DuplicateJobInput {
  count: number;
  value: number;
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
}

function normalizeExpireDate(expireDate?: string | null): string | null {
  if (!expireDate) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(expireDate)) {
    return expireDate;
  }

  const parsedDate = new Date(expireDate);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate.toISOString().split("T")[0] || null;
}

export function buildDuplicateJobSearchParams(job: DuplicateJobInput): string {
  const params = new URLSearchParams();

  params.set("count", String(job.count));
  params.set("value", String(job.value));
  if (job.prefix) params.set("prefix", job.prefix);
  if (job.postfix) params.set("postfix", job.postfix);
  if (job.codeLength) params.set("codeLength", String(job.codeLength));
  if (job.note) params.set("note", job.note);

  const normalizedExpireDate = normalizeExpireDate(job.expireDate);
  if (normalizedExpireDate) {
    params.set("expireDate", normalizedExpireDate);
  }

  if (job.customerIds) params.set("customerIds", job.customerIds);
  if (job.scheduledDate) params.set("scheduledDate", job.scheduledDate);
  if (job.scheduledTime) params.set("scheduledTime", job.scheduledTime);
  if (job.scheduledTimezone) {
    params.set("scheduledTimezone", job.scheduledTimezone);
  }
  if (job.scheduledMessage) {
    params.set("scheduledMessage", job.scheduledMessage);
  }

  return params.toString();
}

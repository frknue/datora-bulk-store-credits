export type StoreCreditBadgeTone =
  | "success"
  | "info"
  | "warning"
  | "caution"
  | "critical"
  | "neutral";

const JOB_TONE_MAP: Record<string, StoreCreditBadgeTone> = {
  pending: "info",
  scheduled: "caution",
  running: "info",
  completed: "success",
  completed_with_errors: "warning",
  failed: "critical",
};

const RECIPIENT_TONE_MAP: Record<string, StoreCreditBadgeTone> = {
  pending: "info",
  succeeded: "success",
  failed: "critical",
};

export function getStoreCreditJobBadgeTone(status: string): StoreCreditBadgeTone {
  return JOB_TONE_MAP[status] ?? "warning";
}

export function getStoreCreditJobBadgeLabel(status: string): string {
  if (status === "completed_with_errors") return "completed with errors";
  return status;
}

export function getStoreCreditRecipientBadgeTone(
  status: string,
): StoreCreditBadgeTone {
  return RECIPIENT_TONE_MAP[status] ?? "warning";
}

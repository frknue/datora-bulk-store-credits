type BadgeTone =
  | "success"
  | "info"
  | "warning"
  | "critical"
  | "auto"
  | "neutral"
  | "caution";

function getJobStatusBadgeTone(status: string): BadgeTone {
  const toneMap: Record<string, BadgeTone> = {
    completed: "success",
    running: "info",
    pending: "info",
    scheduled: "caution",
    failed: "critical",
    cancelled: "neutral",
  };

  return toneMap[status] || "auto";
}

export function renderJobStatusBadge(status: string) {
  const tone = getJobStatusBadgeTone(status);
  return <s-badge tone={tone}>{status}</s-badge>;
}

import { useEffect, useRef, useState } from "react";
import type { JobProgress } from "../types";

interface UseJobProgressPollingOptions {
  enabled?: boolean;
  intervalMs?: number;
  terminalStatuses?: string[];
  onTerminalStatus?: (progress: JobProgress[]) => void;
  /**
   * Progress endpoint to poll. Defaults to the gift-card jobs endpoint.
   * Pass a different path (e.g. "/api/store-credits/progress") to reuse the hook
   * for other job types that expose a matching response shape.
   */
  endpoint?: string;
}

const DEFAULT_TERMINAL_STATUSES = ["completed", "completed_with_errors", "failed"];
const DEFAULT_PROGRESS_ENDPOINT = "/api/jobs/progress";

function buildProgressMap(progressData: JobProgress[]) {
  const progressMap: Record<string, JobProgress> = {};

  progressData.forEach((progress) => {
    progressMap[progress.jobId] = progress;
  });

  return progressMap;
}

function areProgressMapsEqual(
  current: Record<string, JobProgress>,
  next: Record<string, JobProgress>,
) {
  const currentKeys = Object.keys(current);
  const nextKeys = Object.keys(next);

  if (currentKeys.length !== nextKeys.length) {
    return false;
  }

  return nextKeys.every((jobId) => {
    const currentProgress = current[jobId];
    const nextProgress = next[jobId];

    return (
      currentProgress?.jobId === nextProgress?.jobId &&
      currentProgress?.done === nextProgress?.done &&
      currentProgress?.total === nextProgress?.total &&
      currentProgress?.status === nextProgress?.status
    );
  });
}

export function useJobProgressPolling(
  jobIds: string[],
  {
    enabled = true,
    intervalMs = 3000,
    terminalStatuses = DEFAULT_TERMINAL_STATUSES,
    onTerminalStatus,
    endpoint = DEFAULT_PROGRESS_ENDPOINT,
  }: UseJobProgressPollingOptions = {},
) {
  const [jobProgress, setJobProgress] = useState<Record<string, JobProgress>>({});
  const jobIdsRef = useRef(jobIds);
  const onTerminalStatusRef = useRef(onTerminalStatus);
  const terminalStatusesRef = useRef(terminalStatuses);
  const terminalStatusesKey = terminalStatuses.join(",");
  const jobIdsKey = jobIds.join(",");

  useEffect(() => {
    jobIdsRef.current = jobIds;
  }, [jobIds]);

  useEffect(() => {
    onTerminalStatusRef.current = onTerminalStatus;
  }, [onTerminalStatus]);

  useEffect(() => {
    terminalStatusesRef.current = terminalStatuses;
  }, [terminalStatuses]);

  useEffect(() => {
    if (!enabled || jobIdsKey.length === 0) {
      setJobProgress((currentProgress) =>
        Object.keys(currentProgress).length === 0 ? currentProgress : {},
      );
      return;
    }

    let isCancelled = false;
    const currentJobIds = jobIdsRef.current;
    const terminalStatusSet = new Set(terminalStatusesRef.current);

    const fetchProgress = async () => {
      try {
        const res = await fetch(`${endpoint}?ids=${currentJobIds.join(",")}`);
        if (!res.ok || isCancelled) return;

        const progressData: JobProgress[] = await res.json();
        if (isCancelled) return;

        const progressMap = buildProgressMap(progressData);
        setJobProgress((currentProgress) =>
          areProgressMapsEqual(currentProgress, progressMap)
            ? currentProgress
            : progressMap,
        );

        const hasTerminalStatus = progressData.some((progress) =>
          terminalStatusSet.has(progress.status),
        );
        if (hasTerminalStatus) {
          onTerminalStatusRef.current?.(progressData);
        }
      } catch (error) {
        console.error("Error fetching progress:", error);
      }
    };

    void fetchProgress();
    const intervalId = setInterval(() => {
      void fetchProgress();
    }, intervalMs);

    return () => {
      isCancelled = true;
      clearInterval(intervalId);
    };
  }, [enabled, intervalMs, jobIdsKey, terminalStatusesKey, endpoint]);

  return jobProgress;
}

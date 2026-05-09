import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { GiftCardUsageRecord, UsageMetrics, UsageRefreshProgress } from "../types";

interface UseJobUsageTrackingOptions {
  jobId: string;
  canViewUsage: boolean;
  usagePage: number;
  usageRecordsPerPage: number;
  initialUsageLastRefreshedAt: string | Date | null | undefined;
  initialUsageRefreshRemainingMs: number;
}

const QUEUED_USAGE_REFRESH_PROGRESS: UsageRefreshProgress = {
  status: "queued",
  done: 0,
  total: 0,
};

function normalizeUsageLastRefreshedAt(
  value: string | Date | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  return typeof value === "string" ? value : value.toISOString();
}

export function useJobUsageTracking({
  jobId,
  canViewUsage,
  usagePage,
  usageRecordsPerPage,
  initialUsageLastRefreshedAt,
  initialUsageRefreshRemainingMs,
}: UseJobUsageTrackingOptions) {
  const loadFetcher = useFetcher();
  const refreshFetcher = useFetcher();
  const jobActionPath = `/app/gift-cards/${jobId}`;
  const normalizedInitialUsageLastRefreshedAt = normalizeUsageLastRefreshedAt(
    initialUsageLastRefreshedAt,
  );
  const [usageMetrics, setUsageMetrics] = useState<UsageMetrics | null>(null);
  const [usageRecords, setUsageRecords] = useState<GiftCardUsageRecord[]>([]);
  const [usageRecordCount, setUsageRecordCount] = useState(0);
  const [usageLastRefreshedAt, setUsageLastRefreshedAt] = useState<string | null>(
    normalizedInitialUsageLastRefreshedAt,
  );
  const [usageError, setUsageError] = useState<string | null>(null);
  const [usageCooldownRemaining, setUsageCooldownRemaining] = useState(
    initialUsageRefreshRemainingMs,
  );
  const [usageRefreshProgress, setUsageRefreshProgress] =
    useState<UsageRefreshProgress | null>(null);
  const usageLoadLoading = loadFetcher.state !== "idle";
  const usageRefreshLoading = refreshFetcher.state !== "idle";
  const usagePreviewCount = usageRecords.length;
  const totalUsagePages = Math.max(1, Math.ceil(usagePreviewCount / usageRecordsPerPage));
  const normalizedUsagePage = Math.min(usagePage, totalUsagePages);
  const paginatedUsageRecords = usageRecords.slice(
    (normalizedUsagePage - 1) * usageRecordsPerPage,
    normalizedUsagePage * usageRecordsPerPage,
  );

  const processedLoadRef = useRef<unknown>(undefined);
  const processedRefreshRef = useRef<unknown>(undefined);
  const usageInitializedRef = useRef(false);
  const loadFetcherRef = useRef(loadFetcher);
  const pollTimeoutRef = useRef<number | null>(null);
  const initialUsageLastRefreshedAtRef = useRef(normalizedInitialUsageLastRefreshedAt);
  const initialUsageRefreshRemainingMsRef = useRef(initialUsageRefreshRemainingMs);
  loadFetcherRef.current = loadFetcher;
  initialUsageLastRefreshedAtRef.current = normalizedInitialUsageLastRefreshedAt;
  initialUsageRefreshRemainingMsRef.current = initialUsageRefreshRemainingMs;

  const submitUsageLoad = useCallback(() => {
    if (!canViewUsage) return;
    loadFetcherRef.current.submit(
      { intent: "usage" },
      { method: "POST", action: jobActionPath },
    );
  }, [canViewUsage, jobActionPath]);

  useEffect(() => {
    setUsageMetrics(null);
    setUsageRecords([]);
    setUsageRecordCount(0);
    setUsageLastRefreshedAt(initialUsageLastRefreshedAtRef.current);
    setUsageError(null);
    setUsageCooldownRemaining(initialUsageRefreshRemainingMsRef.current);
    setUsageRefreshProgress(null);
    processedLoadRef.current = undefined;
    processedRefreshRef.current = undefined;
    usageInitializedRef.current = false;

    if (pollTimeoutRef.current !== null) {
      window.clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, [jobId]);

  useEffect(() => {
    if (
      normalizedInitialUsageLastRefreshedAt &&
      normalizedInitialUsageLastRefreshedAt !== usageLastRefreshedAt
    ) {
      setUsageLastRefreshedAt(normalizedInitialUsageLastRefreshedAt);
    }

    setUsageCooldownRemaining((currentRemaining) =>
      initialUsageRefreshRemainingMs > currentRemaining
        ? initialUsageRefreshRemainingMs
        : currentRemaining,
    );
  }, [
    initialUsageRefreshRemainingMs,
    normalizedInitialUsageLastRefreshedAt,
    usageLastRefreshedAt,
  ]);

  useEffect(() => {
    if (usageCooldownRemaining <= 0) return;

    const timer = window.setInterval(() => {
      setUsageCooldownRemaining((remaining) => (remaining > 1000 ? remaining - 1000 : 0));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [usageCooldownRemaining]);

  useEffect(() => {
    if (!loadFetcher.data || loadFetcher.data === processedLoadRef.current) return;
    processedLoadRef.current = loadFetcher.data;

    const data = loadFetcher.data as Record<string, unknown>;
    if (data.message && !("metrics" in data)) {
      setUsageError(String(data.message));
      return;
    }

    setUsageError(null);
    setUsageMetrics((data.metrics as UsageMetrics) ?? null);
    setUsageRecords((data.records as GiftCardUsageRecord[]) ?? []);
    setUsageRecordCount(typeof data.recordCount === "number" ? data.recordCount : 0);
    setUsageLastRefreshedAt((data.lastRefreshedAt as string) ?? null);
    setUsageCooldownRemaining(
      typeof data.remainingMs === "number" ? data.remainingMs : 0,
    );
  }, [loadFetcher.data]);

  const pollProgress = useCallback(async () => {
    try {
      const response = await fetch(`/api/jobs/${jobId}/usage/progress`);
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        setUsageError(result?.message || "Failed to check progress");
        return;
      }

      const result = await response.json();
      const progress = result?.progress as UsageRefreshProgress | null;
      if (!progress) {
        pollTimeoutRef.current = window.setTimeout(() => {
          void pollProgress();
        }, 2000);
        return;
      }

      setUsageRefreshProgress(progress);

      if (progress.status === "completed") {
        submitUsageLoad();
      } else if (progress.status === "failed") {
        setUsageError(progress.error || "Background processing failed");
        submitUsageLoad();
      } else {
        pollTimeoutRef.current = window.setTimeout(() => {
          void pollProgress();
        }, 2000);
      }
    } catch {
      setUsageError("Failed to check progress");
    }
  }, [jobId, submitUsageLoad]);

  useEffect(() => {
    if (!refreshFetcher.data || refreshFetcher.data === processedRefreshRef.current) {
      return;
    }
    processedRefreshRef.current = refreshFetcher.data;

    const data = refreshFetcher.data as Record<string, unknown>;
    if (!data.mode) {
      if (typeof data.remainingMs === "number") {
        setUsageCooldownRemaining(data.remainingMs);
      }
      setUsageError(String(data.message || "Failed to refresh usage data"));
      return;
    }

    setUsageError(null);
    if (data.mode === "inline") {
      setUsageRefreshProgress(null);
      submitUsageLoad();
    } else if (data.mode === "background") {
      const progress =
        (data.progress as UsageRefreshProgress | null) ?? QUEUED_USAGE_REFRESH_PROGRESS;
      setUsageRefreshProgress(progress);
      void pollProgress();
    }
  }, [pollProgress, refreshFetcher.data, submitUsageLoad]);

  useEffect(() => {
    if (!canViewUsage) return;
    if (usageInitializedRef.current) return;

    usageInitializedRef.current = true;
    let isCancelled = false;

    const initializeUsage = async () => {
      try {
        const response = await fetch(`/api/jobs/${jobId}/usage/progress`);

        if (response.ok) {
          const result = await response.json();
          const progress = result?.progress as UsageRefreshProgress | null;

          if (isCancelled) return;

          if (progress) {
            setUsageRefreshProgress(progress);

            if (progress.status === "queued" || progress.status === "processing") {
              void pollProgress();
              return;
            }

            if (progress.status === "failed") {
              setUsageError(progress.error || "Background processing failed");
            }
          }
        }
      } catch {
        // Fall back to loading cached usage data.
      }

      if (!isCancelled) {
        submitUsageLoad();
      }
    };

    void initializeUsage();

    return () => {
      isCancelled = true;
      if (pollTimeoutRef.current !== null) {
        window.clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
    };
  }, [canViewUsage, jobId, pollProgress, submitUsageLoad]);

  const refreshUsage = useCallback(() => {
    if (!canViewUsage) return;
    setUsageError(null);
    setUsageRefreshProgress((current) => current ?? QUEUED_USAGE_REFRESH_PROGRESS);
    refreshFetcher.submit(
      { intent: "usage-refresh" },
      { method: "POST", action: jobActionPath },
    );
  }, [canViewUsage, jobActionPath, refreshFetcher]);

  const exportUsage = useCallback(async () => {
    try {
      const response = await fetch(`/api/jobs/${jobId}/usage/export`);
      if (!response.ok) throw new Error(response.statusText);
      const csvContent = await response.text();
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = window.URL.createObjectURL(blob);
      link.setAttribute("download", `${jobId}-usage.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error("Error exporting usage CSV:", error);
    }
  }, [jobId]);

  return {
    usageMetrics,
    paginatedUsageRecords,
    usagePreviewCount,
    usageRecordCount,
    normalizedUsagePage,
    totalUsagePages,
    usageError,
    usageLastRefreshedAt,
    usageCooldownRemaining,
    usageLoading: usageLoadLoading || usageRefreshLoading,
    usageRefreshProgress,
    refreshUsage,
    exportUsage,
  };
}

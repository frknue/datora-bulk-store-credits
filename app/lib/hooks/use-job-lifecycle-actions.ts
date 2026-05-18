import { useAppBridge } from "@shopify/app-bridge-react";
import { useCallback, useEffect, useRef, useState } from "react";

export type JobLifecycleIntent = "retry" | "cancel" | "deactivate" | "resume";

interface JobLifecycleActionState {
  jobId: string;
  intent: JobLifecycleIntent;
}

interface UseJobLifecycleActionsOptions {
  onSuccess?: () => void;
}

// Delay before re-running onSuccess after a cancel, to pick up the worker's
// finalised gift_cards/done once it observes the cancel and exits the create
// loop. Should exceed CANCEL_GRACE_MS on the server (60s) so the second
// refetch lands after the worker has had time to write its terminal state.
const CANCEL_SETTLE_DELAY_MS = 65_000;

export function useJobLifecycleActions(options: UseJobLifecycleActionsOptions = {}) {
  const { onSuccess } = options;
  const shopify = useAppBridge();
  const [activeAction, setActiveAction] = useState<JobLifecycleActionState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const cancelSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearActionError = useCallback(() => setActionError(null), []);

  useEffect(() => {
    return () => {
      if (cancelSettleTimerRef.current !== null) {
        clearTimeout(cancelSettleTimerRef.current);
        cancelSettleTimerRef.current = null;
      }
    };
  }, []);

  const runAction = useCallback(
    async (jobId: string, intent: JobLifecycleIntent) => {
      setActiveAction({ jobId, intent });
      setActionError(null);
      shopify.loading(true);

      const successMessages: Record<JobLifecycleIntent, string> = {
        retry: "Retrying",
        cancel: "Cancelled",
        deactivate: "Deactivating",
        resume: "Resuming",
      };
      const failureMessages: Record<JobLifecycleIntent, string> = {
        retry: "Couldn't retry the job. Please try again.",
        cancel: "Couldn't cancel the job. Please try again.",
        deactivate: "Couldn't deactivate the job. Please try again.",
        resume: "Couldn't resume the job. Please try again.",
      };

      try {
        const response = await fetch(`/app/gift-cards/${jobId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          },
          body: new URLSearchParams({ intent }),
        });

        if (!response.ok) {
          let errorMessage = failureMessages[intent];
          try {
            const data = await response.json();
            if (data && typeof data.message === "string" && data.message.length > 0) {
              errorMessage = data.message;
            }
          } catch {
            // Body wasn't JSON or couldn't be read — fall back to the generic message.
          }
          setActionError(errorMessage);
          return false;
        }

        shopify.toast.show(successMessages[intent]);
        onSuccess?.();
        // Cancel sets DB status to 'cancelled' immediately, but the worker
        // may still be mid-Shopify-call and hasn't yet written the final
        // gift_cards/done. Polling stops on cancelled, so the loader-shown
        // counts can stay stale until reload. Schedule a follow-up refetch
        // after the server-side grace window so the page picks up the
        // worker's finalised state automatically.
        if (intent === "cancel") {
          if (cancelSettleTimerRef.current !== null) {
            clearTimeout(cancelSettleTimerRef.current);
          }
          cancelSettleTimerRef.current = setTimeout(() => {
            cancelSettleTimerRef.current = null;
            onSuccess?.();
          }, CANCEL_SETTLE_DELAY_MS);
        }
        return true;
      } catch (error) {
        console.error(`Error performing ${intent} for job ${jobId}:`, error);
        setActionError(failureMessages[intent]);
        return false;
      } finally {
        setActiveAction(null);
        shopify.loading(false);
      }
    },
    [onSuccess, shopify],
  );

  return {
    activeAction,
    actionError,
    clearActionError,
    cancelJob: (jobId: string) => runAction(jobId, "cancel"),
    retryJob: (jobId: string) => runAction(jobId, "retry"),
    deactivateJob: (jobId: string) => runAction(jobId, "deactivate"),
    resumeJob: (jobId: string) => runAction(jobId, "resume"),
  };
}

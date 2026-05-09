# Cancelled Job: Resume & Deactivate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users resume a cancelled gift-card job from the worker checkpoint and deactivate the partial gift cards already created in Shopify. Triggers live on the job detail page and the gift-cards list row actions.

**Architecture:** Add a new `resumeJob` server action (parallel to `retryJob`) that flips a `cancelled` job back to `pending` and re-triggers the worker — the worker's existing checkpoint logic in `services/worker/internal/shopify/shopify.go:243-249` resumes from `len(job.GiftCards)` automatically. Loosen the existing `deactivateJob` precondition to also accept `status: "cancelled"`. Plumb a new `"resume"` intent through `useJobLifecycleActions`, the job detail page, and the row-actions component. No worker, schema, or migration changes.

**Tech Stack:** React Router 7, Polaris web components, Prisma (PostgreSQL), TypeScript. No unit-test framework is configured for the web app — verification is `npm run typecheck` + `npm run lint` + manual embedded-app QA per `AGENTS.md`. Worker tests already cover the checkpoint path (`TestFinalizeCreateJobResultKeepsCancelledState`).

**Spec:** `docs/superpowers/specs/2026-05-02-cancelled-job-resume-deactivate-design.md`.

---

## File Structure

| Path | Change | Responsibility |
|---|---|---|
| `app/lib/services/job-details.server.ts` | modify | Add `resumeJob`, broaden `deactivateJob`, register `"resume"` intent in `handleJobDetailAction`. |
| `app/lib/hooks/use-job-lifecycle-actions.ts` | modify | Extend `JobLifecycleIntent` with `"resume"`, add `resumeJob` to return value. |
| `app/routes/app.jobs.$jobid.tsx` | modify | Add Resume button; widen Deactivate visibility to include cancelled jobs. |
| `app/features/dashboard/components/dashboard-jobs-table.tsx` | modify | Row action for cancelled jobs: Resume button (+ Deactivate when applicable). Update `intent` union. |
| `app/routes/app.gift-cards.tsx` | modify | Wire `onResume` from the hook into `DashboardJobsTable`. |

No new files. No schema migration. No worker changes.

---

## Task 1: Add `resumeJob` server action

**Files:**
- Modify: `app/lib/services/job-details.server.ts`

This adds a new `resumeJob` async function and wires it into `handleJobDetailAction` under the `"resume"` intent. It atomically transitions `cancelled → pending` (only when `deactivatedAt` is null and `jobType === "create"` and no active deactivate child exists), then calls `triggerWorkerJob`. On worker-trigger failure, rolls back to `cancelled` and returns 502 — mirroring `retryJob`'s rollback at line 281.

- [ ] **Step 1: Add `resumeJob` function**

In `app/lib/services/job-details.server.ts`, immediately after the `retryJob` function (which ends around line 295), add:

```ts
async function resumeJob({
  jobId,
  shopName,
}: JobDetailsPageInput): Promise<JobActionResult> {
  // Block if a deactivate child for this job is in flight.
  const activeDeactivation = await prisma.job.findFirst({
    where: {
      sourceJobId: jobId,
      jobType: "deactivate",
      status: { in: ["pending", "running"] },
    },
    select: { id: true },
  });
  if (activeDeactivation) {
    return {
      body: { message: "Cannot resume while deactivation is in progress" },
      status: 409,
    };
  }

  // Atomic transition: cancelled create-jobs with no deactivatedAt only.
  const result = await prisma.job.updateMany({
    where: {
      id: jobId,
      shopName,
      status: "cancelled",
      deactivatedAt: null,
      jobType: "create",
    },
    data: { status: "pending", finishedAt: null, errorMessage: null },
  });

  if (result.count === 0) {
    return {
      body: { message: "Job cannot be resumed in its current state" },
      status: 409,
    };
  }

  try {
    await triggerWorkerJob(jobId, shopName);
  } catch (error) {
    console.error("Error triggering worker for resume:", error);
    // Roll back so the user can try again. Mirrors retryJob's rollback.
    await prisma.job.updateMany({
      where: { id: jobId, shopName, status: "pending" },
      data: {
        status: "cancelled",
        errorMessage: "Failed to reach worker service. Please try again.",
      },
    });
    return {
      body: { message: "Failed to reach worker service. Please try again." },
      status: 502,
    };
  }

  return { body: { message: "job resuming" } };
}
```

- [ ] **Step 2: Register the `"resume"` intent in `handleJobDetailAction`**

In the same file, update the switch in `handleJobDetailAction` (around line 567). Add a `case "resume"` between `cancel` and `retry`:

```ts
export async function handleJobDetailAction({
  admin,
  currentPlanId,
  intent,
  jobId,
  shopName,
}: JobDetailActionInput): Promise<JobActionResult> {
  switch (intent) {
    case "cancel":
      return cancelJob({ jobId, shopName });
    case "resume":
      return resumeJob({ jobId, shopName });
    case "retry":
      return retryJob({ jobId, shopName });
    case "deactivate":
      return deactivateJob({ currentPlanId, jobId, shopName });
    case "usage":
      return getJobUsage({ currentPlanId, jobId, shopName });
    case "usage-refresh":
      return refreshJobUsage({ admin, currentPlanId, jobId, shopName });
    default:
      return { body: { message: "Unknown intent" }, status: 400 };
  }
}
```

- [ ] **Step 3: Typecheck and lint**

Run:

```bash
npm run typecheck:app
npm run lint:app
```

Expected: both pass with no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/lib/services/job-details.server.ts
git commit -m "feat(jobs): add resumeJob server action for cancelled jobs"
```

---

## Task 2: Broaden `deactivateJob` to accept cancelled jobs

**Files:**
- Modify: `app/lib/services/job-details.server.ts:490-565`

Two changes: the where-clause now accepts both `completed` and `cancelled`; and a new guard returns 400 when a cancelled job has zero gift cards (avoids spawning a no-op deactivation child job).

- [ ] **Step 1: Update the where-clause and add the empty-giftCards guard**

Replace the body of `deactivateJob` (currently `app/lib/services/job-details.server.ts:490-565`) with:

```ts
async function deactivateJob({
  currentPlanId,
  jobId,
  shopName,
}: JobDetailsPageInput & { currentPlanId: number }): Promise<JobActionResult> {
  if (!canDeactivateGiftCards(currentPlanId)) {
    return {
      body: {
        message:
          "Gift card deactivation is available for Premium and Ultimate plans only",
      },
      status: 403,
    };
  }

  const job = await prisma.job.findFirst({
    where: {
      id: jobId,
      shopName,
      status: { in: ["completed", "cancelled"] },
    },
    select: {
      id: true,
      count: true,
      status: true,
      deactivatedAt: true,
      giftCards: true,
    },
  });

  if (!job) {
    return {
      body: { message: "Job not found or not in a deactivatable state" },
      status: 404,
    };
  }

  if (job.deactivatedAt) {
    return {
      body: { message: "Gift cards from this job have already been deactivated" },
      status: 409,
    };
  }

  // For cancelled jobs, refuse if no gift cards were created (nothing to deactivate).
  if (
    job.status === "cancelled" &&
    (!Array.isArray(job.giftCards) || job.giftCards.length === 0)
  ) {
    return {
      body: { message: "No gift cards to deactivate for this job" },
      status: 400,
    };
  }

  // Check if there's already a pending/running deactivation job for this source job.
  const existingDeactivation = await prisma.job.findFirst({
    where: {
      sourceJobId: jobId,
      jobType: "deactivate",
      status: { in: ["pending", "running"] },
    },
  });

  if (existingDeactivation) {
    return {
      body: { message: "A deactivation is already in progress for this job" },
      status: 409,
    };
  }

  // Create a deactivation job that enters the same queue.
  // count is 0 because no new gift cards are created — the original job's count
  // still counts toward the monthly plan limit.
  const deactivationJobId = crypto.randomUUID();
  await prisma.job.create({
    data: {
      id: deactivationJobId,
      jobType: "deactivate",
      sourceJobId: jobId,
      count: 0,
      shopName,
      status: "pending",
    },
  });

  try {
    await triggerWorkerJob(deactivationJobId, shopName);
  } catch (error) {
    console.error("Error triggering worker for deactivation:", error);
    // Don't revert — the job is pending and the scheduler will pick it up.
  }

  return {
    body: { message: "Gift cards will be deactivated shortly" },
  };
}
```

- [ ] **Step 2: Typecheck and lint**

Run:

```bash
npm run typecheck:app
npm run lint:app
```

Expected: both pass with no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/lib/services/job-details.server.ts
git commit -m "feat(jobs): allow deactivate on cancelled jobs with partial cards"
```

---

## Task 3: Extend `useJobLifecycleActions` with `resume`

**Files:**
- Modify: `app/lib/hooks/use-job-lifecycle-actions.ts`

The hook owns the intent union, the success/failure toast messages, and the action callbacks. It posts to the same `/app/jobs/${jobId}` action endpoint with `intent=resume`, which Task 1 wired up.

- [ ] **Step 1: Add `"resume"` to the intent union and toast maps; export the union**

Replace the file's contents with:

```ts
import { useAppBridge } from "@shopify/app-bridge-react";
import { useCallback, useState } from "react";

export type JobLifecycleIntent = "retry" | "cancel" | "deactivate" | "resume";

interface JobLifecycleActionState {
  jobId: string;
  intent: JobLifecycleIntent;
}

interface UseJobLifecycleActionsOptions {
  onSuccess?: () => void;
}

export function useJobLifecycleActions(options: UseJobLifecycleActionsOptions = {}) {
  const { onSuccess } = options;
  const shopify = useAppBridge();
  const [activeAction, setActiveAction] = useState<JobLifecycleActionState | null>(null);

  const runAction = useCallback(
    async (jobId: string, intent: JobLifecycleIntent) => {
      setActiveAction({ jobId, intent });
      shopify.loading(true);

      const successMessages: Record<JobLifecycleIntent, string> = {
        retry: "Retrying",
        cancel: "Cancelled",
        deactivate: "Deactivating",
        resume: "Resuming",
      };
      const failureMessages: Record<JobLifecycleIntent, string> = {
        retry: "Retry failed",
        cancel: "Cancel failed",
        deactivate: "Deactivate failed",
        resume: "Resume failed",
      };

      try {
        const response = await fetch(`/app/jobs/${jobId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          },
          body: new URLSearchParams({ intent }),
        });

        if (!response.ok) {
          shopify.toast.show(failureMessages[intent], { isError: true });
          return false;
        }

        shopify.toast.show(successMessages[intent]);
        onSuccess?.();
        return true;
      } catch (error) {
        console.error(`Error performing ${intent} for job ${jobId}:`, error);
        shopify.toast.show(failureMessages[intent], { isError: true });
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
    cancelJob: (jobId: string) => runAction(jobId, "cancel"),
    retryJob: (jobId: string) => runAction(jobId, "retry"),
    deactivateJob: (jobId: string) => runAction(jobId, "deactivate"),
    resumeJob: (jobId: string) => runAction(jobId, "resume"),
  };
}
```

- [ ] **Step 2: Typecheck and lint**

Run:

```bash
npm run typecheck:app
npm run lint:app
```

Expected: both pass. (Callers that destructure the hook's return haven't been updated yet, but the new field is additive — existing callers compile unchanged.)

- [ ] **Step 3: Commit**

```bash
git add app/lib/hooks/use-job-lifecycle-actions.ts
git commit -m "feat(jobs): add resume intent to useJobLifecycleActions hook"
```

---

## Task 4: Add Resume button + cancelled-state Deactivate to the job detail page

**Files:**
- Modify: `app/routes/app.jobs.$jobid.tsx`

Two visibility changes plus a new button.

`canDeactivate` currently requires `job.status === "completed"`. We widen it to also allow `cancelled` *and* require at least one created card on cancelled jobs.

We add `canResume`, gated by: status is `cancelled`, no `deactivatedAt`, and no `activeDeactivationJobId` (the in-flight child created by Task 2's flow).

We add a Resume secondary-action button calling the new `resumeJob` callback. No confirmation modal — resume is undo-of-cancel.

- [ ] **Step 1: Pull `resumeJob` from the hook and compute `canResume`**

Update the destructure on line 96 and add `canResume` next to the existing flags around line 129–137:

```tsx
const { activeAction, cancelJob, retryJob, deactivateJob, resumeJob } =
  useJobLifecycleActions({
    onSuccess: () => navigate(".", { replace: true }),
  });
```

```tsx
const canRetry = job.status === "failed";
const canCancel = ["scheduled", "pending", "running"].includes(job.status);
const canDuplicate = subscriptionPlan.duplicate && job.status === "completed";
const isDeactivated = !!job.deactivatedAt;
const partialCardCount = totalCards;
const canDeactivate =
  canDeactivateGiftCards(subscriptionPlan) &&
  !isDeactivated &&
  !isDeactivationRunning &&
  (job.status === "completed" ||
    (job.status === "cancelled" && partialCardCount > 0));
const canResume =
  job.status === "cancelled" && !isDeactivated && !isDeactivationRunning;
const isRetrying = activeAction?.jobId === job.id && activeAction.intent === "retry";
const isCancelling = activeAction?.jobId === job.id && activeAction.intent === "cancel";
const isDeactivating =
  activeAction?.jobId === job.id && activeAction.intent === "deactivate";
const isResuming =
  activeAction?.jobId === job.id && activeAction.intent === "resume";
```

`totalCards` is already exposed on the loader payload (see the destructure block at the top of the component). It is the partial-card count we want for the cancelled-deactivate guard.

- [ ] **Step 2: Add the Resume click handler**

Insert next to the other handlers, after `handleCancel` (around line 174):

```tsx
const handleResume = useCallback(() => {
  void resumeJob(job.id);
}, [resumeJob, job.id]);
```

- [ ] **Step 3: Render the Resume button and update disabled props**

In the JSX action cluster (currently around lines 240–276), insert the Resume button right after the Cancel button block, and update the existing Duplicate/Deactivate/Download disabled props to include `isResuming`:

```tsx
{canCancel && (
  <s-button
    slot="secondary-actions"
    onClick={handleCancel}
    loading={isCancelling || undefined}
  >
    Cancel
  </s-button>
)}
{canResume && (
  <s-button
    slot="secondary-actions"
    onClick={handleResume}
    loading={isResuming || undefined}
    disabled={isCancelling || isDeactivating || undefined}
  >
    Resume
  </s-button>
)}
{canRetry && (
  <s-button
    slot="secondary-actions"
    onClick={handleRetry}
    loading={isRetrying || undefined}
  >
    Retry
  </s-button>
)}
{canDuplicate && (
  <s-button
    slot="secondary-actions"
    onClick={handleDuplicate}
    disabled={isRetrying || isCancelling || isResuming || undefined}
  >
    Duplicate
  </s-button>
)}
{canDeactivate && (
  <s-button
    slot="secondary-actions"
    onClick={handleDeactivate}
    loading={isDeactivating || undefined}
    disabled={isRetrying || isCancelling || isResuming || undefined}
  >
    Deactivate
  </s-button>
)}
{job.status === "completed" && canDl && (
  <s-button
    slot="secondary-actions"
    onClick={handleDownload}
    disabled={
      isRetrying || isCancelling || isDeactivating || isResuming || undefined
    }
  >
    Download
  </s-button>
)}
```

- [ ] **Step 4: Typecheck and lint**

Run:

```bash
npm run typecheck:app
npm run lint:app
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add app/routes/app.jobs.\$jobid.tsx
git commit -m "feat(jobs): add Resume button and enable Deactivate on cancelled jobs"
```

---

## Task 5: Add Resume + cancelled-state Deactivate to the gift-cards row actions

**Files:**
- Modify: `app/features/dashboard/components/dashboard-jobs-table.tsx`
- Modify: `app/routes/app.gift-cards.tsx`

Today the row-actions component (`DashboardJobActions`, around line 84) returns `<s-text>—</s-text>` for any status it doesn't know about — which silently swallows `cancelled`. We add a cancelled-status branch that renders Resume (always for cancelled with no `deactivatedAt`) and, when the partial card count > 0 and the plan allows, Deactivate.

We also broaden the `intent` union in two inline type annotations (lines 25 and 239) and plumb a new `onResume` prop from the table down to the row.

- [ ] **Step 1: Update the `intent` union, props, and pass-through in the table component**

In `app/features/dashboard/components/dashboard-jobs-table.tsx`, replace the two inline `intent: "retry" | "cancel" | "deactivate"` annotations with `intent: "retry" | "cancel" | "deactivate" | "resume"`.

Add `onResume: (jobId: string) => void` to:
- `DashboardJobsTableProps` (around line 15-40)
- The inner row props (around line 100-108) used by `DashboardJobActions`
- `DashboardJobRow` props (around line 232-252)

Each component that destructures these props needs to forward `onResume` through. Specifically:

In `DashboardJobsTableProps` (the top-level props block around lines 15–40), append:

```tsx
onResume: (jobId: string) => void;
```

In the inner `DashboardJobActions` props block (around lines 100–108), append `onResume: (jobId: string) => void;`. In `DashboardJobRow` props (around lines 247–251), append the same.

In each function signature destructure that mentions `onCancel, onDeactivate, onDownload, onDuplicate, onRetry`, add `onResume` alongside, and forward it to the next layer (table → row → actions).

- [ ] **Step 2: Add the cancelled-status branch in `DashboardJobActions`**

In `DashboardJobActions` (around lines 84–213), the function currently has branches for `["scheduled","pending","running"]`, `"failed"`, and `"completed"`, then falls through to `<s-text>—</s-text>`. Add a new `cancelled` branch *before* the fall-through return at line 212.

First, add a derived flag near the existing `canDeactivate` (around line 116):

```tsx
const completedCount = Math.max(job.done || 0, 0);
const canDeactivateCancelled =
  canDeactivateGiftCards(subscriptionPlan) &&
  !job.deactivatedAt &&
  completedCount > 0;
const canResumeCancelled = !job.deactivatedAt;
const resumeTooltipId = `job-${job.id}-resume-tooltip`;
const isResuming =
  activeJobAction?.jobId === job.id && activeJobAction?.intent === "resume";
```

Note: `completedCount` and `canDeactivate` already exist; only the two new flags + `resumeTooltipId` + `isResuming` need to be added. `activeJobAction` and `isResuming` flow in via the same path as `isRetrying`/`isCancelling` — see Step 3 for the prop wiring.

Then before the final `return <s-text>—</s-text>;`, insert:

```tsx
if (job.status === "cancelled" && canResumeCancelled) {
  return (
    <s-stack direction="inline" gap="small" alignItems="center">
      <s-tooltip id={resumeTooltipId}>
        <s-text>Resume job</s-text>
      </s-tooltip>
      <s-button
        variant="secondary"
        icon="play"
        interestFor={resumeTooltipId}
        accessibilityLabel="Resume job"
        onClick={() => onResume(job.id)}
        disabled={isActiveActionRow || undefined}
        loading={isResuming || undefined}
      />
      {canDeactivateCancelled && (
        <>
          <s-tooltip id={deactivateTooltipId}>
            <s-text>Deactivate gift cards</s-text>
          </s-tooltip>
          <s-button
            variant="secondary"
            icon="disabled"
            interestFor={deactivateTooltipId}
            accessibilityLabel="Deactivate gift cards"
            onClick={() => onDeactivate(job.id)}
            disabled={isActiveActionRow || undefined}
            loading={isDeactivating || undefined}
          />
        </>
      )}
    </s-stack>
  );
}

return <s-text>—</s-text>;
```

- [ ] **Step 3: Plumb `onResume`/`isResuming` through the row component**

In `DashboardJobRow` (around lines 215–270), the existing destructure adds `isRetrying`/`isCancelling`/`isDeactivating` flags and forwards them to `DashboardJobActions`. Mirror that for resume:

In the `const isActiveActionRow = ...` block (around line 264-267), add:

```tsx
const isResumingRow =
  activeJobAction?.jobId === job.id && activeJobAction?.intent === "resume";
```

Where `<DashboardJobActions ... />` is rendered (search for the JSX usage; in a single-file component this is inside `DashboardJobRow`'s return), add the new props alongside the existing ones:

```tsx
isRetrying={isRetrying}
isCancelling={isCancelling}
isDeactivating={isDeactivating}
isResuming={isResumingRow}
activeJobAction={activeJobAction}
onResume={onResume}
```

If `DashboardJobActions` does not currently take `activeJobAction` as a prop, pass it now (it's needed for the new `isResuming` derivation in Step 2). Also extend the `DashboardJobActions` props block from Step 1 with `isResuming: boolean;` and add `isResuming` to its destructure.

The top-level `DashboardJobsTable` (further down in the file, around line 440+) also forwards `onCancel`/`onRetry`/`onDeactivate` into `DashboardJobRow`. Add `onResume={onResume}` to that JSX usage as well.

- [ ] **Step 4: Wire `onResume` from the page**

In `app/routes/app.gift-cards.tsx`, update the destructure (around line 95) and add a handler:

```tsx
const { activeAction, cancelJob, retryJob, deactivateJob, resumeJob } =
  useJobLifecycleActions({
    onSuccess: () => navigate(".", { replace: true }),
  });
```

Add a callback near the other handlers (around line 195):

```tsx
const handleResume = useCallback(
  (jobId: string) => {
    void resumeJob(jobId);
  },
  [resumeJob],
);
```

Add `onResume={handleResume}` to the `<DashboardJobsTable ... />` JSX (around line 290 next to `onCancel={handleCancel}` etc.).

- [ ] **Step 5: Typecheck and lint**

Run:

```bash
npm run typecheck:app
npm run lint:app
```

Expected: both pass with no new errors. (TypeScript will catch any prop-plumbing gaps from Steps 1–4.)

- [ ] **Step 6: Commit**

```bash
git add app/features/dashboard/components/dashboard-jobs-table.tsx app/routes/app.gift-cards.tsx
git commit -m "feat(jobs): add Resume + cancelled Deactivate row actions to gift cards table"
```

---

## Task 6: Manual QA inside the embedded app

**Files:** none (verification only).

Per `AGENTS.md` "Embedded App Browser Testing": embedded-app behaviour must be verified inside the Shopify admin shell, not just a tunnel URL. Worker-side changes are zero, so the existing Go test (`TestFinalizeCreateJobResultKeepsCancelledState`) already covers the checkpoint path resume depends on.

- [ ] **Step 1: Start the local stack**

```bash
npm run dev
```

Wait for the worker, Redis, and `shopify app dev` to come up.

- [ ] **Step 2: Open the embedded app in a logged-in Chrome session**

Per `AGENTS.md`:

```bash
open -na "Google Chrome" --args \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-shopify-dev \
  "https://admin.shopify.com/store/app-store-apps-furkan/apps/datora-bulk-gift-cards-dev/app"
```

If the developer is already logged into Shopify in that profile, they land on the app. Otherwise, complete login manually before continuing.

- [ ] **Step 3: Resume happy path**

1. Create a 50-card job at $1 each.
2. Once running and progress shows ~10–20 created, click **Cancel** on the job detail page.
3. Confirm status badge becomes "cancelled" and a **Resume** button appears next to **Cancel**.
4. Click **Resume**. Confirm: toast says "Resuming"; status flips to "pending" then "running"; progress continues from the partial count (not 0); job completes at 50/50.

Expected: no duplicate gift cards (the Shopify gift cards index for the shop should show exactly 50 after completion).

- [ ] **Step 4: Cancel-resume-cancel cycle**

1. Create another 50-card job. Cancel at ~10. Resume; cancel again at ~25. Resume again.
2. Confirm Resume keeps advancing the progress and the job eventually completes at 50.

Expected: each cancel saves a checkpoint; each resume picks up; no duplicates.

- [ ] **Step 5: Deactivate on cancelled job**

1. Create a 50-card job. Cancel at ~15.
2. Confirm **Deactivate** button is visible on the detail page (Premium/Ultimate plan required).
3. Click **Deactivate** → confirm modal → confirm. Toast "Deactivating".
4. Confirm the deactivation banner appears with progress, then `deactivatedAt` is set, status badge shows "deactivated", and **Resume** disappears.
5. Confirm the 15 partial gift cards in the Shopify admin are now disabled.

- [ ] **Step 6: Cancelled-with-zero-cards (scheduled)**

1. Create a job scheduled for 5 minutes in the future.
2. Cancel before the scheduler picks it up (status `scheduled` → `cancelled` with `done == 0`).
3. Confirm **Resume** is visible and **Deactivate** is hidden.
4. Click **Resume**. The job runs *now*, not at the original scheduled time.

- [ ] **Step 7: Plan-gate check**

If a Free-plan dev shop is available: cancel a job mid-run and confirm **Deactivate** is hidden on both the detail page and the row, while **Resume** remains visible. (Consistent with current free-plan behaviour for completed-job deactivate.)

- [ ] **Step 8: Gift-cards row actions**

Repeat steps 3 and 5 from the gift-cards list page (`/app/gift-cards`) instead of the detail page. Confirm the cancelled-row shows the Resume play-icon button, and the deactivate-disabled icon button appears when the partial count > 0 and plan allows.

- [ ] **Step 9: Final verify**

Run:

```bash
npm run verify
```

Expected: lint passes, typecheck passes, Go worker tests pass. (`npm run verify` runs all three per `package.json`.)

- [ ] **Step 10: Final commit (if anything pending) and PR**

If there are no outstanding edits (each prior task committed independently), skip to the PR. Otherwise:

```bash
git status
```

If clean, create the PR:

```bash
gh pr create --base dev --title "feat(jobs): resume and deactivate cancelled jobs" --body "$(cat <<'EOF'
## Summary
- Add a Resume action that restarts a cancelled gift-card job from the worker checkpoint (no duplicate cards).
- Allow Deactivate on cancelled jobs that have at least one partial card created (same Premium/Ultimate plan gate as completed-job deactivate).
- Wire both actions into the job detail page and the gift-cards list row actions.
- No worker, schema, or migration changes — relies on the existing checkpoint loop in `services/worker/internal/shopify/shopify.go:243-249`.

Spec: `docs/superpowers/specs/2026-05-02-cancelled-job-resume-deactivate-design.md`.

## Test plan
- [ ] Resume happy path: cancel a 50-card job at ~15, resume, completes at 50/50 with no duplicates.
- [ ] Cancel-resume-cancel-resume cycle preserves checkpoint each time.
- [ ] Deactivate on cancelled with partial cards spawns a deactivation child job; `deactivatedAt` is set; Resume disappears once deactivated.
- [ ] Cancelled-with-zero-cards: Deactivate is hidden; Resume runs the job now (does not re-schedule).
- [ ] Plan gate: Free shop hides Deactivate on cancelled; Resume remains.
- [ ] Gift-cards list row actions match the detail page.
- [ ] `npm run verify` passes.
EOF
)"
```

---

## Self-review notes

**Spec coverage:**
- Q1 (both deactivate and resume) — Tasks 1, 2, 4, 5.
- Q2 (job detail + gift-cards row) — Tasks 4, 5.
- Q3 (Premium/Ultimate gate for deactivate-on-cancelled) — Task 2 keeps `canDeactivateGiftCards`; Task 5 reuses it for the row action.
- Q4 (resume runs now, doesn't restore schedule) — Task 1 sets status directly to `pending`, never `scheduled`.
- Q5 (unlimited cycles) — Task 1 has no cycle counter; manual QA Step 4 verifies.
- Q6 (resume hidden after deactivate) — `canResume` and `canResumeCancelled` both check `!job.deactivatedAt`.
- Behavior matrix rows match `canResume`/`canDeactivate` predicates in Tasks 4 and 5.
- Race conditions in spec: atomic `updateMany` (Task 1 Step 1), pending-queue handled by worker (no plan code), cancel-during-resume by existing worker loop (no plan code), deactivate/resume mutual exclusion via the new active-deactivation guard in Task 1 + existing guard in Task 2, worker-trigger failure rollback in Task 1 Step 1.
- Plan-limit recheck — explicitly excluded; not implemented; documented in spec.

**Testing deviation from spec:** the spec listed unit tests in `app/lib/services/job-details.server.test.ts`. This repo has no TypeScript unit-test runner (verified by `find . -name "*.test.ts"` returning no results and `package.json` having no vitest/jest dependency). Per the convention established in `docs/superpowers/plans/2026-04-22-bfs-compliance.md`, verification for this kind of change is `npm run verify` (lint + typecheck + Go worker tests) plus manual embedded-app QA. Worker-side checkpoint behaviour is already covered by the existing `TestFinalizeCreateJobResultKeepsCancelledState`. If the team wants to add a vitest/jest setup later, this plan does not block that.

**Type consistency:** `JobLifecycleIntent` is exported from the hook in Task 3 but the table component (Task 5) keeps inline string-literal annotations to match the existing style — both lists include `"resume"`. Function names are stable across tasks: `resumeJob` on the server, `resumeJob` returned by the hook, `handleResume` in both pages.

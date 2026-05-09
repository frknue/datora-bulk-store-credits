# Cancelled Job: Resume & Deactivate

**Date:** 2026-05-02
**Status:** Spec — pending implementation plan

## Problem

When a gift-card creation job is cancelled mid-flight, the partial cards already created in Shopify remain enabled, and the user has no way to act on the cancelled job. Today they cannot:

- Deactivate the partial cards (deactivate is only available on `completed` jobs).
- Resume creation to finish the remaining cards (retry is only available on `failed` jobs).

The user has to manually deactivate cards in Shopify admin or create a new job for the missing count — both painful. We extend the existing deactivate flow to cover cancelled jobs and add a new resume action that picks up from the worker's existing checkpoint.

## Goals

- Let users deactivate the partial cards on a cancelled job, using the same flow and plan gate as deactivating a completed job.
- Let users resume a cancelled job, continuing from where the worker stopped (no duplicate cards).
- Support unlimited cancel↔resume cycles on the same job.
- Make terminal states clear: once a cancelled job is deactivated, it is fully terminal.

## Non-goals

- Restoring the original `scheduled` time on resume. Resume always runs now.
- Re-checking plan limits on resume. The original creation already passed the cap.
- Spawning child jobs for the remainder. The resumed job keeps its original ID.
- Worker-side changes. The existing checkpoint loop in `CreateGiftCards` already supports resumption.

## Decisions

| # | Decision |
|---|---|
| Q1 | Both deactivate and resume on cancelled jobs. |
| Q2 | Action triggers live on the job detail page **and** the gift-cards list row actions. |
| Q3 | Deactivate-on-cancelled uses the same Premium/Ultimate plan gate as deactivate-on-completed (`canDeactivateGiftCards`). |
| Q4 | Resume always means "run now from the checkpoint." Original schedule is not restored, even if the job was cancelled while `scheduled`. |
| Q5 | Unlimited cancel↔resume cycles. Each cancel saves a checkpoint; each resume picks up. |
| Q6 | Once a cancelled job is deactivated (`deactivatedAt` is set), resume is hidden. The job is terminal. |

## Behavior matrix

Action visibility on a job, by state:

| Job state | Resume | Deactivate | Retry |
|---|---|---|---|
| `cancelled`, `done < count`, no `deactivatedAt` | ✅ | ✅ if `done > 0` and Premium/Ultimate | hidden |
| `cancelled`, `done == 0` | ✅ | hidden (nothing to deactivate) | hidden |
| `cancelled`, `deactivatedAt` set | hidden (terminal) | hidden | hidden |
| `failed` | hidden | unchanged | ✅ unchanged |
| `completed` | hidden | unchanged | hidden |

`done` here is `len(giftCards)` on the job row — the same count surfaced as job progress today.

## UI surfaces

**Job detail page** — `app/routes/app.jobs.$jobid.tsx`. Add a "Resume" button to the existing action cluster, gated by the matrix above. The existing "Deactivate" button becomes available for cancelled jobs that have at least one created card; it reuses the existing confirmation modal unchanged.

**Gift-cards list row actions** — `app/features/dashboard/components/dashboard-jobs-table.tsx` (used by `app/routes/app.gift-cards.tsx`). Add a "Resume" entry to the row actions menu and make the existing "Deactivate" row entry visible for cancelled jobs that meet the criteria.

**Confirmation:**
- Resume: no modal. Resume is an undo-of-cancel; the button itself is the confirmation.
- Deactivate: existing modal, unchanged copy. The "all N gift cards" count is the partial count, which matches user expectation.

## Backend

### New action: `resumeJob`

In `app/lib/services/job-details.server.ts`, parallel to `retryJob`:

```ts
async function resumeJob({ jobId, shopName }) {
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
    return { body: { message: "Cannot resume while deactivation is in progress" }, status: 409 };
  }

  // Atomic transition: only cancelled create-jobs with no deactivatedAt advance.
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
    return { body: { message: "Job cannot be resumed in its current state" }, status: 409 };
  }

  try {
    await triggerWorkerJob(jobId, shopName);
  } catch (error) {
    console.error("Error triggering worker for resume:", error);
    // Roll back so the user can try again. Mirrors retryJob's rollback behavior.
    await prisma.job.updateMany({
      where: { id: jobId, shopName, status: "pending" },
      data: { status: "cancelled", errorMessage: "Failed to reach worker service. Please try again." },
    });
    return { body: { message: "Failed to reach worker service. Please try again." }, status: 502 };
  }

  return { body: { message: "job resuming" } };
}
```

Wired into `handleJobDetailAction` under a new `"resume"` intent, alongside `cancel`/`retry`/`deactivate`/`usage`/`usage-refresh`.

### Modified action: `deactivateJob`

Two changes in the existing `deactivateJob` (`app/lib/services/job-details.server.ts:490`):

1. Where-clause: `status: { in: ["completed", "cancelled"] }`.
2. New guard: when the job is `cancelled` and `giftCards` is empty, return 400 "No gift cards to deactivate" — prevents spawning a no-op deactivation child job.

Plan gate (`canDeactivateGiftCards`), `deactivatedAt` collision check, and the existing-deactivation check remain unchanged. The worker-side deactivate handler iterates `sourceJob.GiftCards` and is agnostic to whether the source was completed or cancelled — no changes needed there.

### Hook: `useJobLifecycleActions`

Add `resumeJob: (jobId) => runAction(jobId, "resume")` alongside `cancelJob`, `retryJob`, `deactivateJob` in `app/lib/hooks/use-job-lifecycle-actions.ts`. Both UI surfaces share this hook.

## Worker

**No changes.**

- Resume relies on existing checkpoint logic in `services/worker/internal/shopify/shopify.go:243-249`: `CreateGiftCards` reads `job.GiftCards` and starts the loop at `len(giftCards)`. A resumed job re-enters that path naturally because we flip status back to `pending` and call `triggerWorkerJob`.
- Deactivate-on-cancelled relies on the existing handler at `services/worker/internal/handler/handler.go:214`: it loads the source job, iterates `sourceJob.GiftCards`, and calls Shopify deactivation. The cancelled-source case is structurally identical to the completed-source case.

## Race conditions

| Race | Resolution |
|---|---|
| Two concurrent resume clicks. | Atomic `updateMany` with `status: "cancelled"` precondition; only one transitions. The second gets 409. |
| Resume while another job is running for the shop. | Worker's `ClaimJob` returns `ErrShopHasRunningJob`; resumed job remains `pending` until the running job finishes (existing queue behavior, `handler.go:101`). |
| Cancel arrives during a resumed run. | Same path as the original cancel-mid-run. Worker re-checks status each iteration (`shopify.go:250-254`) and saves a fresh checkpoint. |
| Deactivate spawned while resume is pending. | The symmetric guards in both `resumeJob` (new) and `deactivateJob` (existing `existingDeactivation` check at line 525) ensure only one of resume/deactivate is in flight per job. |
| Worker trigger fails after status flip. | Roll back `pending → cancelled`, return 502, mirroring `retryJob` at line 281. |

## Plan-limit recheck on resume

We do **not** recheck the monthly plan limit on resume. Rationale:

- The original creation already passed the cap.
- The remaining cards are part of the same logical job; they were "reserved" against the cap when the job was first created.
- Rechecking would surface false-positive blocks for users who downgraded after cancelling — confusing UX, low real-world value.

Across-month resumes (e.g. cancel on April 30, resume May 1) are accepted as a known minor accounting drift; this matches how the rest of the app already treats the cap.

## Testing

### Web app (TypeScript)

New unit tests in `app/lib/services/job-details.server.test.ts` (or alongside the existing service-action tests, following local convention):

1. `resumeJob` — happy path: `cancelled` with `done < count` → `pending`; `triggerWorkerJob` called exactly once.
2. `resumeJob` — 409 when status is anything other than `cancelled` (`completed`, `running`, `pending`, `failed`).
3. `resumeJob` — 409 when `deactivatedAt` is set.
4. `resumeJob` — 409 when an active deactivate child job exists for this `sourceJobId`.
5. `resumeJob` — 502 path rolls back to `cancelled` when `triggerWorkerJob` throws.
6. `deactivateJob` — happy path on a `cancelled` job with `done > 0` (new coverage).
7. `deactivateJob` — 400 when the cancelled job has empty `giftCards`.
8. `deactivateJob` — existing completed-job tests must continue to pass unchanged.

### Worker (Go)

No new tests. The existing `TestFinalizeCreateJobResultKeepsCancelledState` already covers the cancel-checkpoint path that resume depends on.

### Manual QA

Run inside the Shopify embedded-app context per AGENTS.md "Embedded App Browser Testing":

- Cancel a 100-card job at ~30 created. Confirm Resume and Deactivate appear on both the job detail page and the gift-cards list row.
- Click Resume; confirm the worker picks up at 30 and progresses to 100.
- Cancel mid-resume; confirm the checkpoint advanced and Resume is offered again.
- On a fresh cancelled job, click Deactivate; confirm the deactivation child job runs and `deactivatedAt` is set; confirm Resume disappears.
- Cancel a `scheduled` job before it runs (`done == 0`); confirm Deactivate is hidden and Resume runs the job now.
- Plan-gate: as a Free plan shop, confirm Deactivate is hidden/disabled with the same UX as today's completed-job deactivate.

## Out of scope / open questions

- A "discard" action that hard-deletes a cancelled job's record. Not needed for this feature; the existing list filters and statuses are sufficient.
- Telemetry on resume vs cancel ratio. Useful but not blocking.

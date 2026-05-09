# Rewrite Implementation Plan

This document captures the implementation plan for Datora Bulk Gift Cards V2 so the rewrite stays focused on maintainability and modern Shopify patterns.

## Principles

- Treat the old app as a behavior reference, not an implementation source.
- Migrate merchant capabilities, not old file structures.
- Keep Shopify API usage on Admin GraphQL and the repo-standard API version.
- Use Polaris web components in the embedded app, not React Polaris.
- Keep business rules in service modules and worker code, not duplicated across routes, components, and extensions.
- Prefer thin routes and explicit workflow ownership.

## Current Direction

V2 already has the right broad structure:

- React Router app routes in `app/routes`
- service-oriented server logic in `app/lib/services`
- background job execution in `services/worker`
- Prisma models close to the old app's capability surface
- Redis-backed progress and queue state

The main remaining work is not "copy old features". It is finishing the incomplete capability wiring in the V2 architecture.

## UI Comparison References

These embedded admin URLs are useful when visually comparing merchant workflows during the rewrite:

- Legacy live app:
  `https://admin.shopify.com/store/app-store-apps-furkan/apps/bulk-gift-card-generator-1/app`
- V2 dev app:
  `https://admin.shopify.com/store/app-store-apps-furkan/apps/datora-bulk-gift-cards-v2/app`

Use the legacy app to inspect user flows and information architecture, not as a source of implementation patterns.

## Phase 1: Unified Job Creation

Goal: one clean creation contract shared by embedded app UI and Shopify admin extensions.

Implementation shape:

- Keep `app/lib/services/create-job.server.ts` as the single source of truth for:
  - validation
  - plan gating
  - preset handling
  - customer-targeted creation
  - scheduling metadata
  - worker trigger behavior
- Add a thin extension-facing route at `app/routes/api.jobs.create.ts`.
- Make both admin extensions submit to that route without carrying business logic locally.
- Keep `app/routes/app.job.create.tsx` as a page action that calls the same shared service.

Do not carry over:

- separate creation logic paths per route
- validation drift between embedded app and extension flows

Definition of done:

- embedded app and extensions both create jobs through the same service path
- one canonical request contract exists for job creation

## Phase 2: Scheduled Job Dispatch

Goal: scheduled jobs become a real workflow, not just a stored status.

Implementation shape:

- Define explicit state transitions:
  - `scheduled -> pending -> running -> completed`
  - `scheduled -> cancelled`
  - `pending/running -> failed`
  - `failed -> pending` on retry
- Add a dispatcher path that promotes ready scheduled jobs when `scheduledTimestamp <= now`.
- Keep dispatch ownership in backend orchestration, ideally near the existing worker flow.
- Avoid putting scheduling logic into UI routes.

Do not carry over:

- ad hoc scheduling logic inside page actions

Definition of done:

- scheduled jobs execute automatically at the requested time
- status transitions are deterministic and observable

## Phase 3: Retry and Cancel Lifecycle

Goal: job management reflects real operational actions.

Implementation shape:

- Use `app/lib/services/job-details.server.ts` as the central action layer for retry and cancel.
- Expose real retry/cancel controls in:
  - `app/routes/app.jobs.$jobid.tsx`
  - `app/components/job-details-sections.tsx`
  - `app/components/dashboard-sections.tsx`
- Keep duplicate as a separate action for reusing parameters, not as a substitute for retry.

Do not carry over:

- retry-via-duplicate behavior

Definition of done:

- failed jobs can be retried as retries
- active jobs can be cancelled using explicit state transitions

## Phase 4: Complete Usage Tracking

Goal: finish the usage-tracking capability that V2 already mostly has.

Implementation shape:

- Keep metrics, refresh logic, and queue state in:
  - `app/lib/services/gift-card-tracker.server.ts`
  - `app/lib/services/job-details.server.ts`
  - `app/lib/services/usage-refresh-queue.server.ts`
  - `app/lib/services/usage-refresh-processor.server.ts`
- Ensure the refresh processor is actually executed by a real background entrypoint.
- In the job details UI:
  - separate "load cached usage" from "refresh usage"
  - show last refreshed time
  - show background refresh progress
  - expose usage export
- Rebuild the UI with Polaris web components in the current design system.

Do not carry over:

- tightly coupled old UI/component logic

Definition of done:

- merchants can load usage, refresh it, observe progress, and export it
- large refreshes run in background; small refreshes can run inline

## Phase 5: Presets and Download UX

Goal: refine existing capabilities without recreating the old app surface wholesale.

Implementation shape:

- tighten preset flow around:
  - `app/lib/hooks/use-create-job-form.ts`
  - `app/components/create-job-sections.tsx`
- keep CSV generation owned by:
  - `app/lib/services/job-download.server.ts`
  - `app/routes/api.jobs.download.$jobid.$subscriptionid.ts`
- only rebuild download options that still provide clear merchant value:
  - formatting choices
  - plan-aware download restrictions
  - clearer action affordances

Do not carry over:

- old modal structure or extra UI complexity unless it improves usability

Definition of done:

- presets feel first-class in V2
- download UX matches current product needs, not historical UI shape

## Phase 6: Optional Product UX

Goal: reintroduce only the optional flows that still earn their complexity.

Candidates:

- onboarding
- support/contact flow
- non-essential dashboard promo cards

Implementation shape:

- only implement after core job workflows are solid
- keep isolated from operational business logic
- prefer smaller focused components over dashboard clutter

Definition of done:

- optional UX exists only if it solves a real problem

## Priority Order

1. Unified job creation for app and extensions
2. Scheduled job dispatch
3. Real retry and cancel controls
4. Usage refresh, progress, and export wiring
5. Preset and download UX cleanup
6. Optional onboarding/support/polish

## Non-Goals

- Porting old React Polaris UI structures
- Recreating old route-per-feature architecture
- Copying old code into V2 because it already "worked"
- Reintroducing dashboard/support/promotional clutter by default

## Working Rule

When in doubt:

- preserve the merchant-facing capability
- keep the V2 architecture
- choose the more modern Shopify approach
- do not copy old implementation patterns forward

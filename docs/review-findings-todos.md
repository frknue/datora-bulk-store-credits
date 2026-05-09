# Review Findings TODOs

Status: open checklist from the deep review on 2026-03-27.

How to use this file:
- Change `[ ]` to `[x]` when fixed and verified.
- Add notes or links under each item if the fix spans multiple PRs.
- Prefer closing the verification checkbox only after tests or manual validation pass.
- Refer to items by ID, for example: `TODO-01`, `TODO-07`.

## High Priority

- [ ] TODO-01: Fix job claiming so intended single-job execution per shop cannot be violated.
  Problem:
  Based on product intent, plans allow multiple queued active jobs (`pending`/`running`), but execution should still be serialized to one running job per shop. The current worker claim flow can race and allow two jobs for the same shop to enter `running`.
  Relevant files:
  - [app/lib/subscriptions/plans.ts](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/lib/subscriptions/plans.ts#L57)
  - [app/lib/services/create-job.server.ts](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/lib/services/create-job.server.ts#L257)
  - [services/worker/internal/db/db.go](/Users/furkanulker/git/work/datora_gift_card_app_v2/services/worker/internal/db/db.go#L38)
  - [services/worker/internal/db/db.go](/Users/furkanulker/git/work/datora_gift_card_app_v2/services/worker/internal/db/db.go#L62)
  TODO:
  - Preserve the intended behavior: multiple queued jobs allowed by plan, only one running job per shop.
  - Enforce the running-job serialization atomically in the DB or with a durable lock.
  - Add tests for concurrent claims.
  Verification:
  - [ ] Verified that only one job per shop can enter `running`, even under concurrent triggers.

- [x] TODO-02: Fix cancellation semantics for create jobs.
  Problem:
  A cancelled running create job can still end in `failed` or `completed` after the worker returns.
  Relevant files:
  - [app/lib/services/job-details.server.ts](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/lib/services/job-details.server.ts#L224)
  - [services/worker/internal/shopify/shopify.go](/Users/furkanulker/git/work/datora_gift_card_app_v2/services/worker/internal/shopify/shopify.go#L254)
  - [services/worker/internal/shopify/shopify.go](/Users/furkanulker/git/work/datora_gift_card_app_v2/services/worker/internal/shopify/shopify.go#L418)
  - [services/worker/internal/handler/handler.go](/Users/furkanulker/git/work/datora_gift_card_app_v2/services/worker/internal/handler/handler.go#L275)
  TODO:
  - [x] Preserve `cancelled` as a terminal state end-to-end.
  - [x] Persist partially created cards while keeping the final job state as `cancelled`.
  - [x] Add worker tests for cancel-during-run.
  Verification:
  - [x] `npm run lint`
  - [x] `npm run typecheck`
  - [x] `cd services/worker && go test ./...`
  - [ ] Verified a running create job stays `cancelled` after cancelling it mid-run in the embedded app.

- [ ] TODO-03: Fix auto-deactivation behavior and entitlement enforcement.
  Problem:
  The settings copy says only full-balance cards are affected, but the scheduler/deactivation flow targets all cards in eligible jobs. Also Free/Basic shops can enable the setting even though deactivation is a paid feature.
  Relevant files:
  - [app/routes/app.settings.tsx](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/routes/app.settings.tsx#L47)
  - [app/routes/app.settings.tsx](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/routes/app.settings.tsx#L228)
  - [services/worker/internal/db/db.go](/Users/furkanulker/git/work/datora_gift_card_app_v2/services/worker/internal/db/db.go#L803)
  - [services/worker/internal/shopify/shopify.go](/Users/furkanulker/git/work/datora_gift_card_app_v2/services/worker/internal/shopify/shopify.go#L777)
  TODO:
  - Gate the setting and backend job creation by plan.
  - Implement the intended selection rule for which cards may be auto-deactivated.
  - Align the UI copy with the actual backend behavior.
  Verification:
  - [ ] Verified only entitled shops can enable and execute auto-deactivation.

- [ ] TODO-04: Add consistent embedded-app auth for internal fetch/XHR flows.
  Problem:
  Several protected endpoints rely on bare `fetch` or `useFetcher.submit` without App Bridge session tokens, while some other flows already use `Authorization: Bearer <idToken>`.
  Relevant files:
  - [app/lib/hooks/use-create-job-form.ts](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/lib/hooks/use-create-job-form.ts#L93)
  - [app/lib/hooks/use-job-lifecycle-actions.ts](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/lib/hooks/use-job-lifecycle-actions.ts#L20)
  - [app/lib/hooks/use-job-progress-polling.ts](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/lib/hooks/use-job-progress-polling.ts#L87)
  - [app/lib/hooks/use-job-usage-tracking.ts](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/lib/hooks/use-job-usage-tracking.ts#L152)
  - [app/lib/utils/download.ts](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/lib/utils/download.ts#L11)
  TODO:
  - Standardize authenticated client requests behind a shared helper.
  - Audit all in-app fetches and form posts.
  - Verify behavior inside the real Shopify embedded iframe.
  Verification:
  - [ ] Verified authenticated fetches still work when third-party cookies are unavailable.

- [ ] TODO-05: Fix fallback gift-card handling for email delivery and deactivation.
  Problem:
  Fallback-created cards can end up with `ID: 0`, which breaks notification sending and later deactivation while the job may still report success.
  Relevant files:
  - [services/worker/internal/shopify/shopify.go](/Users/furkanulker/git/work/datora_gift_card_app_v2/services/worker/internal/shopify/shopify.go#L345)
  - [services/worker/internal/shopify/shopify.go](/Users/furkanulker/git/work/datora_gift_card_app_v2/services/worker/internal/shopify/shopify.go#L376)
  - [services/worker/internal/shopify/shopify.go](/Users/furkanulker/git/work/datora_gift_card_app_v2/services/worker/internal/shopify/shopify.go#L815)
  - [services/worker/internal/handler/handler.go](/Users/furkanulker/git/work/datora_gift_card_app_v2/services/worker/internal/handler/handler.go#L236)
  TODO:
  - Define a safe fallback path when Shopify returns a code but not a readable GiftCard object.
  - Prevent email jobs from silently succeeding when notification delivery is impossible.
  - Prevent deactivation jobs from marking source jobs deactivated when some cards were skipped.
  Verification:
  - [ ] Verified fallback-created cards do not silently break downstream workflows.

- [ ] TODO-06: Fix monthly plan-limit enforcement for emailed jobs.
  Problem:
  The API checks quota using request `count`, but the final persisted count is recomputed from `customerIds`, allowing a crafted request to exceed limits.
  Relevant files:
  - [app/routes/api.jobs.create.ts](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/routes/api.jobs.create.ts#L18)
  - [app/lib/services/create-job.server.ts](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/lib/services/create-job.server.ts#L145)
  - [app/lib/services/create-job.server.ts](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/lib/services/create-job.server.ts#L250)
  - [app/lib/services/create-job.server.ts](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/lib/services/create-job.server.ts#L296)
  TODO:
  - Normalize the effective count before validation and quota checks.
  - Reject mismatches between `count` and `customerIds`.
  - Add request-level tests for malformed or crafted email-job payloads.
  Verification:
  - [ ] Verified emailed jobs cannot exceed the monthly quota through crafted payloads.

## Medium Priority

- [ ] TODO-07: Fix download behavior inconsistencies.
  Problem:
  The UI and API use different entitlement rules after plan changes, and `fields=none` currently behaves like `all`.
  Relevant files:
  - [app/routes/app._index.tsx](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/routes/app._index.tsx#L110)
  - [app/routes/app.jobs.$jobid.tsx](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/routes/app.jobs.$jobid.tsx#L131)
  - [app/lib/services/job-download.server.ts](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/lib/services/job-download.server.ts#L70)
  - [app/lib/services/job-download.server.ts](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/lib/services/job-download.server.ts#L103)
  - [app/lib/utils/download.ts](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/lib/utils/download.ts#L9)
  TODO:
  - Decide whether download entitlement follows current plan or job-time plan.
  - Make UI and API match.
  - Fix `none` to mean the intended minimum column set.
  Verification:
  - [ ] Verified download UI and API behave identically after upgrades and downgrades.

- [ ] TODO-08: Fix uninstall and GDPR webhook data handling.
  Problem:
  The webhook handlers assume little or no customer data is stored, but jobs and usage records do contain shop/customer-linked data. `APP_UNINSTALLED` also only deletes sessions.
  Relevant files:
  - [app/routes/webhooks.app.uninstalled.tsx](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/routes/webhooks.app.uninstalled.tsx#L12)
  - [app/routes/webhooks.customer.data-request.tsx](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/routes/webhooks.customer.data-request.tsx#L7)
  - [app/routes/webhooks.customer.redact.tsx](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/routes/webhooks.customer.redact.tsx#L7)
  - [prisma/schema.prisma](/Users/furkanulker/git/work/datora_gift_card_app_v2/prisma/schema.prisma#L36)
  TODO:
  - Define the real data-retention policy.
  - Make uninstall cleanup match that policy.
  - Implement compliant customer GDPR handling if required.
  Verification:
  - [ ] Verified webhook behavior matches the stored data model and compliance requirements.

- [ ] TODO-09: Make usage refresh resilient across restarts.
  Problem:
  Usage refresh queue processing is request-triggered and in-process only, so jobs can remain stuck in `queued` or `processing` after crashes/restarts.
  Relevant files:
  - [app/lib/services/usage-refresh-processor.server.ts](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/lib/services/usage-refresh-processor.server.ts#L79)
  - [app/lib/services/usage-refresh-queue.server.ts](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/lib/services/usage-refresh-queue.server.ts#L17)
  - [app/lib/hooks/use-job-usage-tracking.ts](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/lib/hooks/use-job-usage-tracking.ts#L221)
  TODO:
  - Decide whether this belongs in the Go worker or another durable processor.
  - Add stale-job recovery for usage refresh state.
  - Prevent infinite client polling on abandoned jobs.
  Verification:
  - [ ] Verified usage refresh recovers correctly after restart/crash scenarios.

- [ ] TODO-10: Escape or sanitize support email content.
  Problem:
  Contact form fields are interpolated directly into HTML email.
  Relevant files:
  - [app/routes/api.contact.ts](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/routes/api.contact.ts#L38)
  - [app/routes/api.contact.ts](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/routes/api.contact.ts#L72)
  TODO:
  - Escape user-controlled fields before rendering HTML.
  - Consider a plain-text alternative.
  Verification:
  - [ ] Verified contact emails render safely with untrusted input.

- [x] TODO-11: Remove silent currency/timezone fallback or make it explicit to users.
  Problem:
  If shop metadata fetch fails, create-job defaults fall back to `USD` and `+00:00`, which can produce wrong currency or scheduling defaults.
  Relevant files:
  - [app/routes/app.tsx](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/routes/app.tsx#L16)
  - [app/lib/hooks/use-create-job-form.ts](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/lib/hooks/use-create-job-form.ts#L49)
  TODO:
  - Decide whether to block the page, retry, or show an explicit degraded-state warning.
  Verification:
  - [ ] Verified create-job defaults remain correct when shop metadata fetch fails.

## Build / Quality Gates

- [x] TODO-12: Fix current `lint` and `typecheck` failures.
  Problem:
  The current head does not pass the repo’s own static checks.
  Relevant files:
  - [app/routes/app.faq.tsx](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/routes/app.faq.tsx#L75)
  - [app/features/dashboard/components/dashboard-jobs-table.tsx](/Users/furkanulker/git/work/datora_gift_card_app_v2/app/features/dashboard/components/dashboard-jobs-table.tsx#L222)
  TODO:
  - Remove unsupported Polaris props / invalid JSX text.
  - Remove or use the unused `deactivationProgress` prop.
  Verification:
  - [x] `npm run lint` passes.
  - [x] `npm run typecheck` passes.

## Notes

- Worker tests passed during review: `npm run test:worker`
- Embedded-app browser verification was not run in this review because it requires a live Shopify admin session.

# Separate Store-Credit Limits from Gift-Card Limits

## Summary

Split the shared `maxAmount` cap on `SubscriptionPlan` into two independent limits — `maxGiftCards` and `maxStoreCredits` — and set store-credit caps at roughly one-third of gift-card caps on each paid tier. Store credits carry real-money liability, so a tighter cap creates a clearer upgrade path without feeling restrictive in normal use.

## Context

`SubscriptionPlan` in `app/lib/subscriptions/plans.ts` currently has one `maxAmount` field that is read by both the gift-card and store-credit code paths. Each feature already counts against the cap independently (see the comment at `app/lib/services/store-credit.server.ts:176`), so the number displayed on the pricing table appears twice — once as "Max Gift Cards" and once as "Max Store Credits" — with the same value. Today there is no way to give the two features different caps. The store-credit feature is not yet live, so no merchants have adopted it and no grandfathering is required.

## Goals

- Allow gift-card and store-credit monthly caps to be set independently per plan.
- Establish a lower default store-credit cap on paid tiers.
- Keep the change localized to plan data + call sites; no new abstractions, no DB migration.

## Non-goals

- No new feature flags or gating changes. Store-credit issuance remains gated behind the existing `extension` flag.
- No usage-tracking / analytics changes.
- No grandfathering logic — feature is not live.
- No runtime configurability. Plan data stays hardcoded in `plans.ts`.

## Design

### Data model

In `app/lib/subscriptions/plans.ts`, rename `maxAmount` → `maxGiftCards` and add a sibling `maxStoreCredits: number`. Both use `-1` to mean "unlimited" (same sentinel as today).

| Plan     | maxGiftCards | maxStoreCredits |
| -------- | ------------ | --------------- |
| Free     | 50           | 25              |
| Basic    | 750          | 250             |
| Premium  | 7,500        | 2,500           |
| Ultimate | -1           | -1              |

### Call sites

**Gift-card paths switch to `maxGiftCards`:**

- `app/lib/services/create-job.server.ts:251-253` — quota check + error message.
- `app/routes/app.job.create.tsx:36` — `planMaxAmount` local.
- `app/routes/app.gift-cards.tsx:234` — `planMaxAmount` local.
- `app/services/plan.server.ts` — `PlanLimitId` type, `canCreateGiftCardsWithPlan`, `hasUnlimitedGiftCards`.

**Store-credit paths switch to `maxStoreCredits`:**

- `app/lib/services/store-credit.server.ts:214-216` — quota check + error message.
- `app/routes/app.store-credit._index.tsx:171` — `planMaxAmount` local.

**Overview page** (`app/routes/app._index.tsx:220,277,299`): replace the single `planMaxAmount` with two locals. Pass `maxGiftCards` into the gift-card `DashboardUsageSection` and `maxStoreCredits` into the store-credit one. Each section's `isUnlimited` check uses its own value.

**Subscriptions table** (`app/routes/app.subscriptions.tsx:101-109`): the "Max Gift Cards" row reads `p.maxGiftCards`; the "Max Store Credits" row reads `p.maxStoreCredits`. No layout change — only the `getValue` functions swap fields.

**Plan service** (`app/services/plan.server.ts`):

- `PlanLimitId` becomes `"maxGiftCards" | "maxStoreCredits" | "jobs" | "downloadDays"`.
- `canCreateGiftCardsWithPlan` and `hasUnlimitedGiftCards` reference `maxGiftCards`.
- No new helpers for store credits — the store-credit service reads `plan.maxStoreCredits` directly, matching how gift-card checks are structured today.

### Out of scope

- FAQ copy — verified there are no numeric cap references.
- Build output under `build/client/assets/` — regenerates on next build.

## Verification

- `npm run typecheck` (or project equivalent) passes with no errors. The rename propagates through the `SubscriptionPlan` type and catches any missed call site.
- Subscriptions page (`/app/subscriptions`) renders the two rows with distinct numbers (e.g., Basic shows 750 and 250).
- Creating a gift-card job on Basic still blocks at 750/month.
- Issuing store credit on Basic blocks at 250/month (verified via manual test against the quota check in `store-credit.server.ts`).
- Overview page shows the correct cap in each of the two "This Month" sections.

## Risks

- Missed call site continues using the old `maxAmount` field — mitigated by renaming (the compiler will fail on any stale reference rather than silently reading `undefined`).
- Copy elsewhere in the app that names a specific cap could go stale — grep for the literal numbers (`750`, `7500`, `7,500`) before merge.

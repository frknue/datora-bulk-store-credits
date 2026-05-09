# Separate Store-Credit Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the shared `maxAmount` plan cap into `maxGiftCards` and `maxStoreCredits`, and set store-credit caps at roughly one-third of gift-card caps on each paid tier.

**Architecture:** Additive first, then rename. Introduce `maxStoreCredits` and migrate store-credit code paths to it (Tasks 1–4). Once no store-credit code reads `maxAmount`, rename `maxAmount` → `maxGiftCards` across all gift-card call sites in one atomic pass (Task 5). Every task leaves the project type-clean so commits are independently reviewable.

**Tech Stack:** TypeScript, React Router 7, Prisma. No unit-test framework for the app layer — the TypeScript compiler (`npm run typecheck`) is the primary verification gate. Final manual smoke-check against the running dev server covers behavior.

**Spec:** `docs/superpowers/specs/2026-04-22-separate-store-credit-limits-design.md`

---

### Task 1: Add `maxStoreCredits` to the plan data model

**Files:**
- Modify: `app/lib/subscriptions/plans.ts`

This task is additive — `maxAmount` stays in place. Nothing else in the codebase reads `maxStoreCredits` yet, so the project remains type-clean.

- [ ] **Step 1: Add `maxStoreCredits` to the `SubscriptionPlan` interface**

In `app/lib/subscriptions/plans.ts:1-17`, add the field right after `maxAmount`:

```ts
export interface SubscriptionPlan {
  id: number;
  name: string;
  price: number;
  maxAmount: number;
  maxStoreCredits: number;
  jobs: number;
  support: boolean;
  downloadDays: number;
  downloadName: string;
  duplicate: boolean;
  extension: boolean;
  presets: boolean;
  formatter: boolean;
  usageTracking: boolean;
  deactivation: boolean;
  slackNotifications: boolean;
}
```

- [ ] **Step 2: Add `maxStoreCredits` values to each plan entry**

In `app/lib/subscriptions/plans.ts:22-91`, add the field to each of the four plan objects. Place it immediately after the existing `maxAmount` line in each object.

- Free (id 1): `maxStoreCredits: 25,`
- Basic (id 2): `maxStoreCredits: 250,`
- Premium (id 3): `maxStoreCredits: 2500,`
- Ultimate (id 4): `maxStoreCredits: -1,`

Example for the Basic entry:

```ts
  {
    id: 2,
    name: "Basic",
    price: 9.95,
    maxAmount: 750,
    maxStoreCredits: 250,
    jobs: 1,
    support: false,
    downloadDays: -1,
    downloadName: "unlimited",
    duplicate: true,
    extension: true,
    presets: false,
    formatter: true,
    usageTracking: false,
    deactivation: false,
    slackNotifications: false,
  },
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS — all files typecheck. No other code reads `maxStoreCredits` yet, so no downstream errors.

- [ ] **Step 4: Commit**

```bash
git add app/lib/subscriptions/plans.ts
git commit -m "feat(plans): add maxStoreCredits field to SubscriptionPlan"
```

---

### Task 2: Switch the store-credit service to use `maxStoreCredits`

**Files:**
- Modify: `app/lib/services/store-credit.server.ts:175-218`

The store-credit quota check currently borrows `canCreateGiftCardsWithPlan` and reads `plan.maxAmount`. Replace that with an inline limit check against `plan.maxStoreCredits` and update the error message text.

- [ ] **Step 1: Update the comment about the monthly counter**

In `app/lib/services/store-credit.server.ts:175-176`, change the comment to reference the new field. Find:

```ts
  // Store credit has its own monthly usage — independent of the gift-card
  // counter. Each feature draws from its own plan.maxAmount allowance.
```

Replace with:

```ts
  // Store credit has its own monthly usage — independent of the gift-card
  // counter. Each feature has its own allowance (plan.maxGiftCards vs
  // plan.maxStoreCredits).
```

- [ ] **Step 2: Replace the quota check block**

In `app/lib/services/store-credit.server.ts:213-218`, find:

```ts
  if (!canCreateGiftCardsWithPlan(plan, monthlyUsed, numericIds.length)) {
    const remaining = Math.max(0, plan.maxAmount - monthlyUsed);
    return buildErrorResult(
      `Your ${plan.name} plan allows ${plan.maxAmount} total issues per month. You can issue ${remaining} more this month.`,
    );
  }
```

Replace with:

```ts
  const storeCreditLimit = plan.maxStoreCredits;
  const wouldExceedLimit =
    storeCreditLimit !== -1 &&
    monthlyUsed + numericIds.length > storeCreditLimit;
  if (wouldExceedLimit) {
    const remaining = Math.max(0, storeCreditLimit - monthlyUsed);
    return buildErrorResult(
      `Your ${plan.name} plan allows ${storeCreditLimit} store credits per month. You can issue ${remaining} more this month.`,
    );
  }
```

- [ ] **Step 3: Check whether `canCreateGiftCardsWithPlan` is still imported**

Run: `grep -n "canCreateGiftCardsWithPlan" app/lib/services/store-credit.server.ts`
Expected: no matches (the function is no longer used in this file).

If the import statement still exists (check near the top of the file), remove `canCreateGiftCardsWithPlan` from the import list. The exact import line depends on how the file groups imports — edit the existing `import { ... } from "...plan.server"` line to drop only that symbol, leaving any other symbols intact.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS. If it fails with "`canCreateGiftCardsWithPlan` is declared but never read" or an unused-import error, revisit Step 3.

- [ ] **Step 5: Commit**

```bash
git add app/lib/services/store-credit.server.ts
git commit -m "feat(store-credit): enforce plan.maxStoreCredits quota"
```

---

### Task 3: Read `maxStoreCredits` in the store-credit route and overview

**Files:**
- Modify: `app/routes/app.store-credit._index.tsx:171`
- Modify: `app/routes/app._index.tsx:220-221,277,299`

Split the single `planMaxAmount` local on the overview into two so each "This Month" section gets its own cap. Store credits switch fully to `maxStoreCredits`; gift cards stay on `maxAmount` until Task 5.

- [ ] **Step 1: Update the store-credit index**

In `app/routes/app.store-credit._index.tsx:171`, find:

```ts
  const planMaxAmount = subscriptionPlan.maxAmount;
```

Replace with:

```ts
  const planMaxAmount = subscriptionPlan.maxStoreCredits;
```

Leave `isUnlimited` and `isAtLimit` on the lines below unchanged — they still compare against the local `planMaxAmount`.

- [ ] **Step 2: Split the overview's `planMaxAmount` into two locals**

In `app/routes/app._index.tsx:220-221`, find:

```ts
  const planMaxAmount = subscriptionPlan.maxAmount;
  const isUnlimited = planMaxAmount === -1;
```

Replace with:

```ts
  const maxGiftCardsCap = subscriptionPlan.maxAmount;
  const maxStoreCreditsCap = subscriptionPlan.maxStoreCredits;
  const giftCardsUnlimited = maxGiftCardsCap === -1;
  const storeCreditsUnlimited = maxStoreCreditsCap === -1;
```

- [ ] **Step 3: Update the gift-card `DashboardUsageSection`**

In `app/routes/app._index.tsx:274-279`, find:

```tsx
            <DashboardUsageSection
              totalGiftCardsThisMonth={giftMonthlyUsed}
              planName={subscriptionPlan.name}
              planMaxAmount={planMaxAmount}
              isUnlimited={isUnlimited}
            />
```

Replace with:

```tsx
            <DashboardUsageSection
              totalGiftCardsThisMonth={giftMonthlyUsed}
              planName={subscriptionPlan.name}
              planMaxAmount={maxGiftCardsCap}
              isUnlimited={giftCardsUnlimited}
            />
```

- [ ] **Step 4: Update the store-credit `DashboardUsageSection`**

In `app/routes/app._index.tsx:296-301`, find:

```tsx
            <DashboardUsageSection
              totalGiftCardsThisMonth={creditMonthlyUsed}
              planName={subscriptionPlan.name}
              planMaxAmount={planMaxAmount}
              isUnlimited={isUnlimited}
            />
```

Replace with:

```tsx
            <DashboardUsageSection
              totalGiftCardsThisMonth={creditMonthlyUsed}
              planName={subscriptionPlan.name}
              planMaxAmount={maxStoreCreditsCap}
              isUnlimited={storeCreditsUnlimited}
            />
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/routes/app.store-credit._index.tsx app/routes/app._index.tsx
git commit -m "feat(ui): show maxStoreCredits on store-credit and overview pages"
```

---

### Task 4: Make the subscriptions table show distinct caps per feature

**Files:**
- Modify: `app/routes/app.subscriptions.tsx:101-109`

Each row's `getValue` function pulls from a different plan field.

- [ ] **Step 1: Update the "Max Store Credits" row**

In `app/routes/app.subscriptions.tsx:101-109`, find:

```ts
const limits: { label: string; getValue: (p: SubscriptionPlan) => string }[] = [
  {
    label: "Max Gift Cards",
    getValue: (p) => formatMonthlyLimit(p.maxAmount),
  },
  {
    label: "Max Store Credits",
    getValue: (p) => formatMonthlyLimit(p.maxAmount),
  },
```

Replace with:

```ts
const limits: { label: string; getValue: (p: SubscriptionPlan) => string }[] = [
  {
    label: "Max Gift Cards",
    getValue: (p) => formatMonthlyLimit(p.maxAmount),
  },
  {
    label: "Max Store Credits",
    getValue: (p) => formatMonthlyLimit(p.maxStoreCredits),
  },
```

Gift-card row still reads `maxAmount`; Task 5 will rename it.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/routes/app.subscriptions.tsx
git commit -m "feat(subscriptions): show maxStoreCredits on pricing table"
```

---

### Task 5: Rename `maxAmount` → `maxGiftCards`

**Files:**
- Modify: `app/lib/subscriptions/plans.ts`
- Modify: `app/services/plan.server.ts:22,70-71,153`
- Modify: `app/lib/services/create-job.server.ts:251,253`
- Modify: `app/routes/app.job.create.tsx:36`
- Modify: `app/routes/app.gift-cards.tsx:234,236`
- Modify: `app/routes/app._index.tsx:220`
- Modify: `app/routes/app.subscriptions.tsx:104`

This is an atomic rename — after Task 4, every remaining `maxAmount` reference is a gift-card site. Do all files in one task so the project stays type-clean.

- [ ] **Step 1: Rename the field in the interface and plan data**

In `app/lib/subscriptions/plans.ts`:

- Line 5: change `maxAmount: number;` to `maxGiftCards: number;`
- In each of the four plan entries (Free, Basic, Premium, Ultimate), change `maxAmount: <N>,` to `maxGiftCards: <N>,`. Values stay identical: 50, 750, 7500, -1.

- [ ] **Step 2: Update `plan.server.ts`**

In `app/services/plan.server.ts:22`, find:

```ts
type PlanLimitId = "maxAmount" | "jobs" | "downloadDays";
```

Replace with:

```ts
type PlanLimitId = "maxGiftCards" | "maxStoreCredits" | "jobs" | "downloadDays";
```

In `app/services/plan.server.ts:68-73`, find:

```ts
export function canCreateGiftCardsWithPlan(
  plan: SubscriptionPlan,
  totalCreatedThisMonth: number,
  requestedCount = 1,
): boolean {
  return (
    getPlanLimit(plan, "maxAmount") === -1 ||
    totalCreatedThisMonth + requestedCount <= getPlanLimit(plan, "maxAmount")
  );
}
```

Replace with:

```ts
export function canCreateGiftCardsWithPlan(
  plan: SubscriptionPlan,
  totalCreatedThisMonth: number,
  requestedCount = 1,
): boolean {
  return (
    getPlanLimit(plan, "maxGiftCards") === -1 ||
    totalCreatedThisMonth + requestedCount <= getPlanLimit(plan, "maxGiftCards")
  );
}
```

In `app/services/plan.server.ts:152-154`, find:

```ts
  public async hasUnlimitedGiftCards(): Promise<boolean> {
    return (await this.getNumericLimit("maxAmount")) === -1;
  }
```

Replace with:

```ts
  public async hasUnlimitedGiftCards(): Promise<boolean> {
    return (await this.getNumericLimit("maxGiftCards")) === -1;
  }
```

- [ ] **Step 3: Update `create-job.server.ts`**

In `app/lib/services/create-job.server.ts:250-255`, find:

```ts
  if (!canCreateGiftCardsWithPlan(plan, totalGiftCardsCreatedThisMonth, count)) {
    const remaining = Math.max(0, plan.maxAmount - totalGiftCardsCreatedThisMonth);
    return buildErrorResult(
      `Your ${plan.name} plan allows ${plan.maxAmount} gift cards per month. You can create ${remaining} more this month.`,
    );
  }
```

Replace with:

```ts
  if (!canCreateGiftCardsWithPlan(plan, totalGiftCardsCreatedThisMonth, count)) {
    const remaining = Math.max(0, plan.maxGiftCards - totalGiftCardsCreatedThisMonth);
    return buildErrorResult(
      `Your ${plan.name} plan allows ${plan.maxGiftCards} gift cards per month. You can create ${remaining} more this month.`,
    );
  }
```

- [ ] **Step 4: Update `app.job.create.tsx`**

In `app/routes/app.job.create.tsx:36`, find:

```ts
  const planMaxAmount = subscriptionPlan.maxAmount;
```

Replace with:

```ts
  const planMaxAmount = subscriptionPlan.maxGiftCards;
```

- [ ] **Step 5: Update `app.gift-cards.tsx`**

In `app/routes/app.gift-cards.tsx:234`, find:

```ts
  const planMaxAmount = subscriptionPlan.maxAmount;
```

Replace with:

```ts
  const planMaxAmount = subscriptionPlan.maxGiftCards;
```

Leave lines 235-236 (`isUnlimited` and `isAtLimit`) unchanged — they read the local `planMaxAmount`.

- [ ] **Step 6: Update `app._index.tsx`**

In `app/routes/app._index.tsx:220`, find:

```ts
  const maxGiftCardsCap = subscriptionPlan.maxAmount;
```

Replace with:

```ts
  const maxGiftCardsCap = subscriptionPlan.maxGiftCards;
```

- [ ] **Step 7: Update `app.subscriptions.tsx`**

In `app/routes/app.subscriptions.tsx:102-105`, find:

```ts
  {
    label: "Max Gift Cards",
    getValue: (p) => formatMonthlyLimit(p.maxAmount),
  },
```

Replace with:

```ts
  {
    label: "Max Gift Cards",
    getValue: (p) => formatMonthlyLimit(p.maxGiftCards),
  },
```

- [ ] **Step 8: Verify no stragglers remain**

Run: `grep -rn "maxAmount" app --include="*.ts" --include="*.tsx"`
Expected: only matches in `app/routes/app.store-credit.create.tsx` (which references `STORE_CREDIT_RULES.maxAmount` — a different constant, not the plan field). No matches in `app/lib/subscriptions/`, `app/services/plan.server.ts`, `app/lib/services/create-job.server.ts`, or any other `app/routes/app.*.tsx` file that reads `subscriptionPlan.maxAmount`.

If any stale reference remains, fix it to use `maxGiftCards`.

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck`
Expected: PASS. Any failure here means a rename was missed; the compiler will name the file and line.

- [ ] **Step 10: Commit**

```bash
git add app/lib/subscriptions/plans.ts app/services/plan.server.ts app/lib/services/create-job.server.ts app/routes/app.job.create.tsx app/routes/app.gift-cards.tsx app/routes/app._index.tsx app/routes/app.subscriptions.tsx
git commit -m "refactor(plans): rename maxAmount to maxGiftCards"
```

---

### Task 6: Full verification

**Files:** None modified. This task only runs checks and performs a manual smoke test.

- [ ] **Step 1: Run the full verify suite**

Run: `npm run verify`
Expected: PASS — lint, typecheck (app + extensions), and worker Go tests all green.

- [ ] **Step 2: Start the dev server**

Run: `npm run dev`
Expected: dev server boots (Redis + worker + `shopify app dev`).

- [ ] **Step 3: Visual check on the subscriptions page**

Open the app inside Shopify admin, navigate to `/app/subscriptions`.
Expected: the "Max Store Credits" row shows **25 / 250 / 2,500 / Unlimited** across Free / Basic / Premium / Ultimate, while "Max Gift Cards" still shows **50 / 750 / 7,500 / Unlimited**.

- [ ] **Step 4: Visual check on the overview page**

Navigate to `/app`.
Expected: the "Gift Cards — This Month" usage section shows the current plan's gift-card cap (e.g., 750 on Basic). The "Store Credits — This Month" section shows the store-credit cap (e.g., 250 on Basic). On Ultimate both show "Unlimited".

- [ ] **Step 5: Optional — behavior spot-check on Basic**

If a Basic-tier test store is handy:

- Create a gift-card job. The `planMaxAmount` on the create page still reads 750; creation beyond 750/month returns the existing error.
- Issue a store credit. The quota check now blocks at 250/month with the message "Your Basic plan allows 250 store credits per month. You can issue N more this month."

Skip this step if no Basic test store is available; the type-check plus the visual checks already exercise the data path.

- [ ] **Step 6: No commit**

This task is verification only.

---

## Verification summary

- `npm run verify` passes after Task 5.
- Subscriptions table renders distinct gift-card vs. store-credit caps.
- Overview "This Month" sections pass their own cap to each `DashboardUsageSection`.
- Gift-card create flow still blocks at 750 on Basic; store-credit create flow now blocks at 250 on Basic.
- No residual `subscriptionPlan.maxAmount` or `plan.maxAmount` references remain (grep from Task 5 Step 8 confirms).

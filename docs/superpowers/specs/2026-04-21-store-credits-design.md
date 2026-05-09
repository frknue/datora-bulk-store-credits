# Store Credits — Design

**Status:** Draft (MVP scope agreed)
**Date:** 2026-04-21
**Author:** backend@datora.de

## Summary

Add a Store Credits feature to the Datora Bulk Gift Cards V2 app. The MVP lets merchants bulk-issue Shopify store credit to a list of customers: one amount, one currency, optional expiry, optional scheduling. Store Credits ships as its own top-level page, its own Prisma models, its own API routes, and its own Go worker handler. It is intentionally separate from the existing gift-card pipeline.

This spec covers only the MVP. Follow-up features (ledger view, debit/reverse, B2B, recurring, per-recipient variable amounts) are out of scope but the data model leaves clear seams for them.

## MVP Scope

In scope:

- New top-level page `Store Credits` with its own create form and history list.
- Bulk issue: customer list + uniform amount + merchant-selected currency + optional `expiresAt` + `notify` toggle (default on) + optional note + optional scheduled send.
- Customer recipients only (no B2B `CompanyLocation` in MVP).
- Per-recipient result tracking and job-level progress polling (mirrors the existing gift-card progress UX).
- Subscription-plan limit enforcement reuses the same monthly cap as gift cards.
- Preflight warning when the shop is on classic customer accounts (store credit is unredeemable without new customer accounts).

Out of scope (explicitly deferred):

- Ledger / balance view of issued credit.
- Debit / reverse (`storeCreditAccountDebit`) flows.
- B2B `CompanyLocation` recipients.
- Per-recipient variable amounts (CSV upload with `email,amount`).
- Recurring / scheduled-repeat credits.
- Custom email templates (Shopify sends the notification via `notify: true`).
- New Playwright e2e coverage (manual verification only for first release).

## Why Store Credits, and why separate from gift cards

Store credit and gift cards look superficially similar but differ on almost every axis post-issue:

| | Gift cards | Store credit |
|---|---|---|
| Artifact | Encrypted code we store and email | No artifact — balance on a customer-owned account |
| Delivery | App-sent email with code | Shopify-sent notification via `notify: true` |
| Tracking | `GiftCardUsage` table (balance, redemption, auto-deactivation) | Transactions live on Shopify and are queried as needed |
| Currency | One, from shop default | Per account, per currency |
| Reversal | Deactivate the card | `storeCreditAccountDebit` |
| Roadmap | Largely stable | Ledger, debit, B2B, recurring all planned |

Shared surface is thin (customer-list input, progress counters, scheduling fields, dashboard listing pattern). Forcing both through one `Job` model would mean a growing nullable-field sprawl and a worker `switch` where each branch is a different product. Separate models avoid that and let each feature evolve on its own cadence.

## Architecture

New units (bold) alongside existing structure:

- **`app/routes/app.store-credit.tsx`** — index (history list).
- **`app/routes/app.store-credit.create.tsx`** — create form.
- **`app/routes/app.store-credit.$jobId.tsx`** — job detail with live progress and recipient table.
- **`app/routes/api.store-credits.create.ts`** — React Router action for form submission.
- **`app/routes/api.store-credits.progress.$jobId.ts`** — progress GET endpoint.
- **`app/lib/services/store-credit.server.ts`** — validation, DB writes, history queries, progress lookup.
- **`services/worker/internal/storecredit/`** — Go package: handler, Admin API client wrapper, rate-limit/retry logic.
- `services/worker/cmd/worker/main.go` — register the new consumer alongside the existing gift-card consumer (same binary, same Redis connection, two queues).
- `app/routes/app.tsx` — add `<s-link href="/app/store-credit">Store Credits</s-link>` to the top nav, between Home and Subscriptions.

### New Shopify scopes

Add to `shopify.app.dev.toml` for MVP; promote to `shopify.app.prod.toml` at go-live:

- `read_store_credit_accounts`
- `write_store_credit_account_transactions`
- `read_store_credit_account_transactions`

## Data model (Prisma)

```prisma
model StoreCreditJob {
  id                 String                    @id
  shopName           String                    @map("shop_name")
  userId             BigInt?                   @map("user_id")
  status             String                    @default("pending")       // pending|running|completed|completed_with_errors|failed
  amount             Decimal                   @db.Decimal(10, 2)
  currency           String                                                // ISO 4217
  expiresAt          DateTime?                 @map("expires_at")
  notify             Boolean                   @default(true)
  note               String?
  customerIds        String                    @map("customer_ids")        // comma-separated Customer GIDs
  count              Int                       @default(0)
  done               Int                       @default(0)
  failed             Int                       @default(0)
  errorMessage       String?                   @map("error_message")
  scheduledDate      String?                   @map("scheduled_date")
  scheduledTime      String?                   @map("scheduled_time")
  scheduledTimezone  String?                   @map("scheduled_timezone")
  scheduledTimestamp String?                   @map("scheduled_timestamp")
  scheduledMessage   String?                   @map("scheduled_message")
  createdAt          DateTime                  @default(now()) @map("created_at")
  finishedAt         DateTime?                 @map("finished_at")
  recipients         StoreCreditJobRecipient[]

  @@index([shopName, status])
  @@index([createdAt])
  @@map("store_credit_job")
}

model StoreCreditJobRecipient {
  id            String         @id @default(uuid())
  jobId         String         @map("job_id")
  customerId    String         @map("customer_id")         // Customer GID
  accountId     String?        @map("account_id")          // StoreCreditAccount GID (success)
  transactionId String?        @map("transaction_id")      // StoreCreditAccountCreditTransaction GID (success)
  status        String         @default("pending")         // pending|succeeded|failed
  errorMessage  String?        @map("error_message")
  processedAt   DateTime?      @map("processed_at")
  job           StoreCreditJob @relation(fields: [jobId], references: [id], onDelete: Cascade)

  @@index([jobId])
  @@index([customerId])
  @@map("store_credit_job_recipient")
}
```

`customerIds` stays as a comma-separated string on the parent job to match existing form/loader conventions; the worker expands it into `StoreCreditJobRecipient` rows when it picks up the job.

## API & data flow

### Create path (web → DB → worker)

1. Merchant submits the create form → `POST /api/store-credits/create`.
2. Action calls `authenticate.admin(request)`, then `store-credit.server.ts#createStoreCreditJob`, which:
   - Validates `amount > 0`, `currency` is a known ISO code, `customerIds` non-empty, `expiresAt` (if set) is in the future, `scheduledTimestamp` (if set) is in the future.
   - Enforces subscription-plan limits (shared with gift cards — credits count toward the same monthly cap) and the concurrent-job limit.
   - Writes a `StoreCreditJob` row with `status='pending'` (or `'scheduled'` if `scheduledTimestamp` is set), `count = len(customerIds)`.
   - If not scheduled, calls `triggerStoreCreditJob(jobId, shopName)` — HTTP POST to the Go worker's `/run-store-credit-job` endpoint with the PSK header. Mirrors the existing `triggerWorkerJob` pattern for gift cards.
   - Returns `{ jobId, status }`; UI redirects to `/app/store-credit/{jobId}`.

### Worker (Go)

`cmd/worker/main.go` registers a new authenticated route `/run-store-credit-job` alongside the existing `/run-job`. Same binary, same PSK middleware, same concurrency semaphore. Per job, the handler:

1. Atomically claims the job with an UPDATE … WHERE status IN ('pending','scheduled') RETURNING … pattern (mirrors `db.ClaimJob`). Idempotent: already-running/completed jobs return 200 without re-processing.
2. Flips `status='running'`, fans `customerIds` into `StoreCreditJobRecipient` rows with `status='pending'`.
3. For each recipient, calls:

   ```graphql
   mutation IssueStoreCredit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
     storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
       storeCreditAccountTransaction {
         id
         amount { amount currencyCode }
         account { id balance { amount currencyCode } }
       }
       userErrors { field message }
     }
   }
   ```

   with `id = customer GID`, `creditInput = { creditAmount: { amount, currencyCode }, expiresAt?, notify }`.
4. On success: store `accountId`, `transactionId`; set recipient `status='succeeded'`, `processedAt=now`. Increment `StoreCreditJob.done`.
5. On `userErrors` or HTTP error after retry exhaustion: set recipient `status='failed'`, store `errorMessage`. Increment `StoreCreditJob.failed`.
6. Update Redis hash `store_credit_job_status:{jobId}` (fields: `done`, `total`, `status`) after each recipient. Shape mirrors the gift-card `job_status:{jobId}` hash so the UI poll hook can be shared.
7. Reuse the existing throttle/backoff utility from the gift-card Shopify client for rate limits.
8. When all recipients processed, set `status = done == count ? 'completed' : (done > 0 ? 'completed_with_errors' : 'failed')`, `finishedAt=now`.

### Scheduling

If `scheduledTimestamp` is set, the job is created with `status='scheduled'` and the worker is **not** triggered synchronously. The existing background scheduler (`handler.StartBackgroundDispatchers`) gains a second loop that polls `StoreCreditJob` for `status='scheduled' AND scheduledTimestamp <= now()` every 30 seconds and dispatches them by invoking the same handler logic in-process.

### Progress polling

`GET /api/store-credits/progress?ids=...` reads from Redis hash `store_credit_job_status:{jobId}` per ID, falling back to the DB row when the hash is missing. Response shape matches the existing `/api/jobs/progress` endpoint so the poll hook can be reused.

## UI

### Navigation

Add `<s-link href="/app/store-credit">Store Credits</s-link>` to the nav in `app/routes/app.tsx`. Order: Home · **Store Credits** · Subscriptions · Help · Changelog · Settings.

### Create form (`/app/store-credit/create`)

Fields, top to bottom:

- Customer picker (reuse the existing `customerIds` picker component) — required.
- Amount — `Decimal`, required, must be > 0.
- Currency — `<s-select>` from a fixed ISO 4217 list (EUR, USD, GBP, CAD, AUD, JPY to start). Default to shop currency. Extendable later.
- Expiration date — optional date picker; passed as `expiresAt` on every credit transaction.
- Notify customer — `<s-checkbox>`, default **checked**.
- Note — optional free-text, stored on the job for merchant records; not sent to Shopify.
- Scheduled send — reuse the existing scheduling block (date, time, timezone, optional message).

Submit button text: "Issue store credit".

**Preflight banner:** when the shop is on classic customer accounts (detected via `Shop.customerAccountsV2`), show a Polaris banner warning that store credit is unredeemable until the shop migrates. The merchant can still submit (they may be mid-migration).

### History list (`/app/store-credit`)

Columns: ID · Created · Amount × Recipients · Currency · Scheduled · Status · Done / Failed / Total. Primary action: `Create store credit job` button.

### Job detail (`/app/store-credit/:jobId`)

- Header: status, progress bar (done + failed / count), `Amount × Recipients = Total`, created-at, finished-at.
- Recipient table: Customer (email + link to Shopify admin customer page), Amount, Status, Error (if any), Processed-at. Customer emails are resolved on render by batching the stored `customerId` GIDs through the Admin `nodes(ids: [])` query — we do not persist emails on the recipient row (they can change on the customer record).
- Pagination: 50 rows per page.
- While `status='running'`, polls the progress endpoint on the existing interval.

### Dashboard touch-up (`/app`)

Add a small "Recent Store Credit jobs" card alongside the existing dashboard content, linking to `/app/store-credit`. Minimal change — the real surface is the dedicated page. Exact placement TBD during implementation after reading the current dashboard layout; the spec requires only that the card exist and link out.

## Error handling

- **Per-recipient failures** are expected and isolated. One bad Customer GID does not fail the whole job; the job ends in `completed_with_errors` with per-recipient reasons visible on the detail page.
- **Auth / 5xx / rate-limit errors** retry with backoff up to the existing policy's attempt count; after exhaustion, the recipient is marked `failed` with the last error message.
- **Plan-limit exhaustion mid-job** — recipients beyond the limit are marked failed with a specific reason (`plan_limit_exceeded`); the job does not silently truncate.
- **Classic customer accounts** — surfaced as a preflight banner (see UI section), not an error.
- **Currency limits** — `storeCreditAccountCredit` enforces per-currency account limits; `userErrors` messages surface verbatim in the recipient row.

## Testing

- **Service unit tests** (`app/lib/services/store-credit.server.test.ts`): amount/currency/customer/date validation, past-date rejection, plan-limit enforcement.
- **Worker unit tests** (Go): success path, `userErrors` handling, HTTP retry/backoff, rate-limit handling, partial-failure status resolution. GraphQL client is mocked.
- **Worker integration test**: one job, three recipients, one intentional failure — asserts DB state and Redis progress contents against an Admin API fixture.
- **Manual e2e** via the AGENTS.md Chrome/CDP flow: issue a small credit to one dev-store customer, verify the `StoreCreditAccount` appears in Shopify admin with the expected balance, verify the notification email is received when `notify=true`.
- **No new Playwright coverage in MVP.** Manual verification in the real embedded app is more valuable for a first release with Shadow-DOM-sensitive Polaris components.

## Migration & rollout

1. Land Prisma migration for the two new tables (`store_credit_job`, `store_credit_job_recipient`).
2. Update `shopify.app.dev.toml` scopes; merchant re-auth prompt at next dev install.
3. Merge and deploy the web app and worker together (worker needs the new tables; web needs the worker running to process jobs).
4. Promote scopes to `shopify.app.prod.toml` at go-live — triggers a re-auth for existing merchants; document in the changelog.
5. No data backfill; feature starts empty.

## Open questions

None at spec time. All design decisions are locked:

- Scope: bulk-issue only (A).
- Input: reuse `customerIds` picker with uniform amount (A).
- Owner: customers only, no B2B (A).
- Currency: merchant picks per job (B).
- Notify: toggle, default on (B).
- Architecture: fully separate model and pipeline from gift cards (3').

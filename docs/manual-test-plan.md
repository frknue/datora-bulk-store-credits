# Manual test plan — full app

A pre-push manual QA pass over the Datora Bulk Gift Cards V2 app. Covers the embedded admin app, the Go worker, the admin extensions, and the lifecycle/webhook surface.

Scope notes:
- Functional flows merchants actually use, not unit-test territory.
- The 10 commits ahead of `origin/dev` introduce concurrency fixes and UI copy changes; tests that specifically exercise those are flagged with **(branch fix)** so you can prioritize them, but the plan itself targets the whole app.
- "Pass" means: no console errors, no worker panics, no 5xx unless deliberate, and the expected UI/DB outcome is observed.

Run priority: **P1 (must pass)** → **P2 (important)** → **P3 (smoke)**. If short on time, P1 + the **(branch fix)** tests are the minimum.

---

## 0. Setup

1. `npm run dev` — Redis, Go worker, and `shopify app dev` start together via `dev.sh`. Tail the worker stdout in a visible terminal.
2. Apply pending migrations: `npx prisma migrate dev`. The branch hasn't added new ones, so this should be a no-op.
3. Open the app inside the Shopify admin shell (per `CLAUDE.md` browser-auth flow). Tunnel-only URLs aren't sufficient — embedded iframe behaviour and session cookies differ.
4. Open **two** browser tabs to the embedded app, signed into the same dev store. Several tests need concurrent clicks.
5. Have **DevTools → Network** open in at least one tab to inspect 4xx/5xx responses.
6. Optional but useful: `npx prisma studio` in another terminal to inspect DB rows directly. `redis-cli` to peek at `job_status:*` hashes.
7. Confirm the dev store has at least: a few customers, a payment method (test card if needed for billing flows), and the app installed cleanly (no leftover stuck running jobs from previous sessions — if so, the worker will reconcile to `failed` on startup).

If anything below fails or behaves unexpectedly, capture the failing request/response, the worker log lines, and the DB row state before moving on.

---

## 1. Auth & lifecycle (P1)

### 1.1 Install / re-install
- Uninstall the dev app from the dev store, then reinstall via the Shopify CLI dev URL.
- **Expected**: OAuth handshake succeeds, you land on `/app` (overview), no errors. A `Session` row exists in the DB.

### 1.2 Embedded app load
- Reload the app inside Shopify admin a few times.
- **Expected**: No flash of unauthenticated content, App Bridge initialises, the `s-page` shell renders, no console errors related to auth or iframe.

### 1.3 Uninstall webhook
- Trigger an uninstall (Apps → uninstall in admin).
- **Expected**: `webhooks.app.uninstalled` fires; the `Session` row is removed (or marked invalid). No leftover advisory locks (`SELECT * FROM pg_locks WHERE locktype='advisory';`).

### 1.4 Scopes update
- If you can update scopes via the CLI/Partner dashboard, do so and re-auth.
- **Expected**: `webhooks.app.scopes_update` fires; the new scopes take effect; existing sessions don't break. Skip if no scope change is meaningful.

### 1.5 GDPR webhooks
- POST a synthetic `customer.data-request`, `customer.redact`, and `shop.redact` payload (curl or `gh-webhook` tool) signed with the app's secret.
- **Expected**: Each webhook returns 200. `customer.redact` removes any PII tied to the customer. `shop.redact` cleans up shop-specific tables. Inspect DB to confirm.

---

## 2. Onboarding & dashboards (P2)

### 2.1 First-run onboarding modal **(branch fix: hierarchy)**
- Set `User.completedOnboarding = false` for the dev shop in `prisma studio` (or use a fresh install).
- Reload `/app`.
- **Expected**:
  - Modal opens with step 1 ("Welcome").
  - Footer **Next** is the most prominent (primary) button. The in-content step CTA (`Start tour`, `Learn more`, etc.) is `secondary` — visible but lower visual weight. The optional sibling on the last step (`View FAQ`) is `tertiary`.
  - Clicking the in-content CTA navigates to its destination and closes the modal.
  - Clicking **Skip tutorial** (modal footer secondary-actions slot) closes the modal and sets `completedOnboarding = true`.
  - Walking through to **Finish** also sets `completedOnboarding = true`.
  - All step labels are sentence case (`Start tour`, `Create gift cards`, `Learn more`, `View export options`, `View FAQ` — `FAQ` stays uppercase).

### 2.2 Overview dashboard `/app`
- Land on `/app`.
- **Expected**:
  - Top-level cards summarise gift cards and store credits (counts, plan limits).
  - "Manage" tertiary buttons navigate to `/app/gift-cards` and `/app/store-credit`.
  - Callout cards: **Get in touch with us** card (if `User.showContactCard = true`) is dismissible; clicking the X (icon-only with `accessibilityLabel="Dismiss"`) hides it and persists `showContactCard = false`. Verify across reload.
  - "Need help" / feature callout cards render correctly.
  - Status badges in the recent-jobs preview use the new tones: `pending` info (blue), `cancelled` neutral (grey), `completed` success (green), `failed` critical (red), `running` info (blue), `scheduled` caution (amber), `deactivated` warning (orange).

### 2.3 Gift cards page `/app/gift-cards`
- Open the gift-cards table.
- **Expected**:
  - Primary action button reads `Create gift cards` (sentence case) and routes to `/app/job/create`.
  - Table lists jobs with the right columns (ID, status, count, value, date).
  - Filters/sorts (if any) work without resetting on poll.
  - Selection: select multiple rows, the bulk action bar appears with `Clear selection` (tertiary) and `Download selected` (primary, sentence case).

---

## 3. Gift card creation (P1)

### 3.1 Basic create
- `/app/job/create` → quantity 5, value 10, no prefix/postfix/expiry/recipients.
- Click **Create gift cards** (label confirmed sentence case).
- **Expected**:
  - Button shows loading spinner (no label swap to "Creating…" or similar).
  - Job appears in the table as `pending`, transitions to `running`, then `completed`.
  - Polling updates the progress live.
  - On the detail page after completion: 5 cards listed, status badge `completed` (success/green).

### 3.2 Prefix / postfix / custom code length
- Create a 3-card job with prefix `TEST`, postfix `EOY`, code length 8.
- **Expected**: Each generated code starts with `TEST`, ends with `EOY`, and total visible code length matches expectation (the inner segment respects `codeLength`).

### 3.3 Expiry date
- Create a job with an `expireDate` 1 month out.
- **Expected**: Job completes; cards have the expiration set in Shopify admin (verify by opening one card in the Shopify admin gift-cards section).

### 3.4 Customer-targeted gift cards (immediate email)
- Create a job with 2 customer IDs selected, no scheduled timestamp.
- **Expected**:
  - Job runs successfully.
  - Each customer receives a gift card notification email immediately (verify in Mailtrap / dev SMTP / Shopify customer event log).
  - Job's `customerIds` field is populated.

### 3.5 Customer-targeted scheduled email
- Create a job with 2 customers and a `scheduledTimestamp` 2 minutes out.
- **Expected**:
  - Job's gift cards are created immediately, but the recipient notification fires at the scheduled timestamp (or the worker schedules it via Shopify's `sendNotificationAt`).
  - Verify by checking the customer event log in Shopify after the scheduled time.

### 3.6 Plan-limit enforcement
- Pick a plan with a low `maxGiftCards` (or temporarily lower it via `prisma studio`). Create jobs until you hit the cap.
- **Expected**: Once `totalGiftCardsThisMonth >= maxGiftCards`, the create form is disabled (`isAtLimit` true), an upgrade CTA appears, and the table shows an `Upgrade plan` button. Submitting via API directly should also be refused.

### 3.7 Scheduled job
- Create a job with a `scheduledTimestamp` 2 minutes in the future.
- **Expected**:
  - Job is `scheduled` immediately after submit.
  - Status badge is `caution` (amber).
  - At the scheduled time, the worker scheduler promotes it to `pending` and dispatches it. Verify in worker logs and DB.

### 3.8 Code collision handling
- Hard to test deterministically. If you can pre-seed the DB with a code that the generator might collide on, do so. Otherwise skip.
- **Expected**: The worker retries up to 50 times with new codes (`maxCodeRetries = 50` in `shopify.go`).

### 3.9 Network resilience (manual)
- Mid-job, briefly take the worker's network down (e.g., kill `shopify app dev` proxy or block `*.myshopify.com` in `/etc/hosts`).
- **Expected**: Worker retries with exponential backoff (up to 5 attempts). If it recovers, job continues. If it exhausts retries, job fails and the row gets an `error_message`.

---

## 4. Job lifecycle actions (P1)

For all action tests, verify both the request behaviour AND the UI state (loading spinner, toast message, post-action navigation/refetch).

### 4.1 Cancel a running job
- Cancel a job mid-creation.
- **Expected**:
  - Cancel toast shows.
  - Job status flips to `cancelled` immediately. Status badge is `neutral` (grey).
  - Polling stops on cancel (no terminal-status event fires for cancelled by default).
  - Row actions transition: Cancel hidden, **Resume** and (if any cards were made) **Deactivate** become visible — but during the 60s grace, both will be refused server-side (see 4.3, 4.4).

### 4.2 Cancel auto-refetch **(branch fix #4)**
- Cancel a 50-card job within the first 1–2 seconds (before the worker writes the first checkpoint at card 25). Stay on the page.
- **Expected**:
  - Initial post-cancel render shows `done = 0` and Deactivate likely hidden.
  - After ~65 seconds, the page auto-refetches without user action. The `done` count now reflects the worker's finalised partial count (likely 1–25 cards). If any cards were created, **Deactivate** becomes visible.
  - Repeated cancels within 65s only schedule one timer (no stacking).

### 4.3 Resume during grace **(branch fix #1)**
- Cancel a running job. Within ~5 seconds, click **Resume**.
- **Expected**: 409 with body `{ "message": "Cancellation is still finalising. Please try again in a moment." }`. Toast shows the same. Status remains `cancelled`.

### 4.4 Resume after grace
- Continue from 4.3. Wait until ~70 seconds since cancel. Click **Resume** again.
- **Expected**: Status flips to `pending`, worker picks it up, polling restarts, progress resumes from where it left off (worker reads the existing `gift_cards` checkpoint and continues).

### 4.5 Deactivate during grace **(branch fix #2)**
- Cancel a running job. Within ~5 seconds, click **Deactivate** on the cancelled row.
- **Expected**: 409 with the "Cancellation is still finalising" message. No deactivation child created.

### 4.6 Deactivate a completed job
- On a completed job (with cards), click **Deactivate** → confirm in modal.
- **Expected**:
  - Confirm modal: cancel button reads `Cancel`; primary action reads `Deactivate gift cards` with `tone="critical"` (red).
  - On confirm: deactivation child job created; UI shows it running with progress.
  - Each card in Shopify admin transitions to `disabled`.
  - Source job's `deactivatedAt` is set on completion. Status badge changes to `deactivated` (warning/orange).
  - Re-clicking Deactivate is refused (`Gift cards from this job have already been deactivated`).

### 4.7 Deactivate a cancelled job (after grace)
- Cancel a job mid-flight, wait past grace, click **Deactivate**.
- **Expected**: Same as 4.6 but operates on the partial card set. The worker reads the source job's now-finalised `gift_cards` and deactivates those.

### 4.8 Resume + Deactivate concurrent click **(branch fix #3)**
- Cancelled job past grace. Tab A on Resume, Tab B on Deactivate. Click both as close to simultaneously as possible. Repeat both orders.
- **Expected**: One succeeds, the other gets 409 with one of:
  - `Cannot resume while deactivation is in progress`
  - `Job cannot be resumed in its current state`
  - `A deactivation is already in progress for this job`
  - `Job not found or not in a deactivatable state`
- The system never ends up with the source job `pending` AND a pending deactivation child for it.

### 4.9 Retry a failed job
- Make a job fail (e.g., kill the worker mid-job — startup reconciliation will mark the row `failed`). Click **Retry**.
- **Expected**:
  - Status transitions `failed` → `pending` → `running`. Worker continues from existing checkpoint (does not regenerate cards already created).
  - If the worker is unreachable when retry is clicked, the action returns 502 and the job rolls back to `failed` with a `Failed to reach worker service` error message.

### 4.10 Duplicate a completed job
- On a completed job, click **Duplicate**.
- **Expected**: Routes to `/app/job/create` with the form pre-filled (count, value, prefix, postfix, code length, expiry, message — but NOT customer IDs unless intentional).

### 4.11 Per-shop single-job invariant **(branch fix #5)**
- Create two `scheduled` jobs in the same shop with the same scheduled timestamp 2 minutes out. Wait until the time hits.
- **Expected**:
  - Worker picks up one, runs it to completion (or until cancelled). Then runs the second.
  - At no point are two jobs `running` simultaneously for the same shop. Worker log should show `Another job is still running for shop ...` if the scheduler tries to dispatch the second prematurely.
  - DB never has two `running` rows for the same `shop_name`.

### 4.12 Stale running reconciliation
- Manually set a row's `status='running'` in `prisma studio`. Restart the worker.
- **Expected**: On startup, `ReconcileStaleRunningJobs` flips it to `failed` with error message `Worker restarted while job was running. Please retry.` Verify in worker log + DB.

### 4.13 Auto-deactivation
- Set `User.autoDeactivateDays = 0` for the dev shop. Have at least one completed (non-deactivated) `create` job.
- **Expected**: On the next scheduler tick, the worker creates a `pending` deactivation child. It runs, deactivates all cards, marks `deactivatedAt` on the source.

---

## 5. Downloads & exports (P2)

### 5.1 Per-job download
- On a completed job, click **Download** → opens `/app/jobs/$jobid/download`.
- Choose separator (comma/semicolon), case (upper/lower), include header toggle, etc.
- Click **Download**.
- **Expected**: Button shows loading spinner, label `Download` stays. CSV file downloads with the right format. Open and confirm: header row (if enabled), correct separator, correct case for codes.

### 5.2 Batch download
- Select multiple completed jobs in `/app/gift-cards`. Click **Download selected**.
- **Expected**: Routes to `/app/gift-cards/download` with the selected job IDs. Same form options. CSV contains cards from all selected jobs, with a column or grouping that identifies which job each card came from.

### 5.3 Plan gating on download
- On a plan that doesn't include downloads (or for a job too old for the plan's retention window), Download should be hidden or disabled.
- Verify by attempting to download via direct URL — server-side check should refuse.

### 5.4 Usage CSV export
- On a completed job's detail page → Usage section → click **Export CSV** (after data has been refreshed).
- **Expected**: CSV downloads with usage rows (initial value, current balance, redeemed, status, balance status).

---

## 6. Usage tracking (P2)

Available on completed jobs; gated by plan (`canUseUsageTracking`).

### 6.1 First refresh (inline, < 500 cards)
- On a completed job with < 500 cards, click **Fetch usage data**.
- **Expected**:
  - Button shows loading spinner.
  - Usage section populates with metrics (totals, redemption rate, balance breakdown, status breakdown), pie chart, bar chart, and a preview table of up to 100 records.
  - `usageLastRefreshedAt` is set; cooldown timer (1 hour) starts.

### 6.2 Cooldown enforcement
- Within the cooldown window, click **Refresh data** → button label includes `Refresh (Xm Ys)` and is disabled. Server-side direct call should also return 429.

### 6.3 Refresh after cooldown
- Wait out the cooldown (or set `usageLastRefreshedAt` to >1 hour ago in `prisma studio`). Click **Refresh data**.
- **Expected**: Usage data refreshes; metrics update if any redemptions occurred.

### 6.4 Background refresh (≥ 500 cards)
- On a completed job with ≥ 500 cards (or temporarily lower the `INLINE_USAGE_THRESHOLD` in code).
- Click **Fetch usage data**.
- **Expected**: Response says `Usage refresh queued` with `mode: "background"`. The background processor picks it up; the UI shows progress (queued → processing → completed). After completion, refreshing the page shows full metrics.

### 6.5 Usage refresh blocked by running job
- Try to refresh usage on a completed job while another job is running in the same shop.
- **Expected**: 409 `Cannot fetch usage tracking while gift card creation is in progress.`

### 6.6 Usage refresh error path
- Simulate a Shopify API failure (e.g., revoke token temporarily).
- **Expected**: Banner with error message; **Try again** button (sentence case) appears.

---

## 7. Store credit (P1 / P2)

### 7.1 Store credit dashboard `/app/store-credit`
- View the index page.
- **Expected**:
  - Primary action `Issue store credit` (sentence case).
  - Empty state shows when no jobs yet.
  - Job table lists store-credit jobs with statuses (`pending`, `scheduled`, `running`, `completed`, `completed_with_errors`, `failed`).

### 7.2 Issue store credit (single recipient)
- `/app/store-credit/create` → select 1 customer, choose currency, set amount, optional expiry, optional message.
- Click **Issue store credit**.
- **Expected**:
  - Button shows loading spinner; label stays `Issue store credit` (no swap to `Issuing…` — branch fix #2.2).
  - Job created and dispatched to the worker.
  - On completion, the customer has the store credit attached in Shopify admin.
  - Recipient row shows status `succeeded`.

### 7.3 Issue store credit (multiple recipients)
- Select 5+ customers, issue.
- **Expected**: Job runs through each recipient. If any fail, status is `completed_with_errors` and the failed recipient row has `failed` status with an error message.

### 7.4 Plan limit on store credits
- With `maxStoreCredits` reached, attempt to create a job.
- **Expected**: Server-side rejection. UI shows the limit/upgrade CTA.

### 7.5 Customer picker
- Click the customer picker (Polaris Resource Picker via App Bridge).
- **Expected**: Picker opens, lists customers from the dev store, selection returns to the form.

### 7.6 Store credit job detail
- Click into a store-credit job from the table.
- **Expected**: Detail page shows recipients, statuses, amount, currency, dates. Note button (icon-only) appears only when a note exists; tooltip shows the note text on hover.

### 7.7 Recipient backfill / retry
- If the feature exists, retry failed recipients on a `completed_with_errors` job. Verify logic.

---

## 8. Subscriptions (P2)

### 8.1 View plans
- `/app/subscriptions` lists all plans.
- **Expected**:
  - Current plan card has its button reading `Current plan` (sentence case) and disabled.
  - Other plan cards show `Upgrade to <Plan>` or `Downgrade to <Plan>` based on price.
  - Plan limits (`maxGiftCards`, `maxStoreCredits`, downloads, deactivation, usage tracking) are listed.

### 8.2 Upgrade flow
- Click `Upgrade to <Plan>`.
- **Expected**: Routes to Shopify's billing approval. After approving, returns to the app and the active plan updates. Verify in DB and via the badge.

### 8.3 Downgrade flow
- From a paid plan, click `Downgrade to <Plan>`. Confirm modal opens.
- **Expected**:
  - Confirm modal cancel button reads `Cancel`; primary action reads `Confirm downgrade` (sentence case) with `tone="critical"`.
  - On confirm, plan downgrades. If the new plan is below current usage (e.g., already used > new `maxGiftCards`), verify the system handles that gracefully (UI shows "you've exceeded the new plan's limit").

---

## 9. Settings (P2)

### 9.1 Auto-deactivation save
- `/app/settings` → toggle auto-deactivation, set days, **Save**.
- **Expected**: Toast confirms save; `User.autoDeactivateDays` updates in DB. Reload to confirm persistence.

### 9.2 Slack webhook save
- Toggle Slack on, paste a webhook URL, **Save**.
- **Expected**: Toast confirms save; `User.slackWebhookUrl` persists.

### 9.3 Slack test notification **(branch fix #2.2)**
- With Slack enabled and a valid webhook URL saved, click **Send test notification**.
- **Expected**:
  - Button shows loading spinner; label stays `Send test notification` (no swap to `Sending...`).
  - A Slack message arrives at the configured channel.
  - On invalid URL: returns error toast; no message.
  - On unreachable URL: error toast `Failed to reach webhook URL.`

### 9.4 Slack notification on job completion
- Trigger a job that completes successfully.
- **Expected**: Slack receives a notification with job ID, count, value, currency, completion status.

### 9.5 Slack notification on failure
- Trigger a job that fails.
- **Expected**: Slack receives a notification with `Status: failed` and the error message.

### 9.6 Slack notification on deactivation
- Run a deactivation. Verify Slack message includes job type `deactivate` and count.

### 9.7 Plan gating
- On a plan where Slack isn't included (Free/Basic), Slack settings should be disabled or hidden, with an `Upgrade your plan` link.

---

## 10. Contact, FAQ, changelog (P3)

### 10.1 Contact form
- `/app/contact` → fill subject, message, **Send**.
- **Expected**: Button shows loading spinner; label stays `Send`. Email is sent (check the configured destination). Success toast.

### 10.2 Contact dismiss-and-restore
- Confirm `User.showContactCard = true`, dismiss the contact card on `/app`, verify it stays dismissed across reloads. To restore (if there's UI for that), test that path.

### 10.3 FAQ links
- `/app/faq` → click a few FAQ entries (anchored expansions). Click **Contact support** at the bottom — routes to `/app/contact?subject=help`.

### 10.4 Changelog
- `/app/changelog` renders without errors.

---

## 11. Admin extensions (P2)

### 11.1 send-gift-cards (single customer)
- In the Shopify admin, open a single customer. Trigger the **Send gift cards** admin action.
- **Expected**: Extension opens; flow leads to a job creation prefilled with that customer.

### 11.2 send-gift-cards-segment (segment / multiple)
- In the Shopify admin, select a customer segment or multi-select customers. Trigger the segment admin action.
- **Expected**: Extension opens; flow leads to job creation prefilled with the selection.

### 11.3 support-link admin link
- In the Shopify admin app menu for this app, click the **Support** link.
- **Expected**: Routes to the app's support page (likely `/app/contact` or `/app/faq`).

---

## 12. Worker behaviour (P2)

Mostly observable via worker stdout + DB inspection.

### 12.1 ClaimJob lock **(branch fix #5)**
- Already covered by 4.11.
- After the test, run `SELECT * FROM pg_locks WHERE locktype='advisory';` — should be empty when no claim is in flight.

### 12.2 Stale running reconciliation
- Already covered by 4.12.

### 12.3 Scheduled job promotion
- Already covered by 3.7.

### 12.4 Code collision retry log
- Look for `Code collision on card N (attempt M/50), regenerating code...` lines if collisions happen during a large job. Should not fail the job up to 50 attempts.

### 12.5 Network retry log
- If you exercised 3.9, look for `Network error (attempt N/5)... Retrying in Xs` lines.

### 12.6 Rate-limit (HTTP 429) handling
- If Shopify returns 429s during a large bulk job, look for the `Retry-After` honouring in worker logs. Hard to trigger deliberately; observe if it happens naturally.

### 12.7 Auto-deactivation scheduler
- Already covered by 4.13.

### 12.8 Dispatch-on-exit
- After a job completes (or is cancelled), if there's a pending job for the same shop, the worker should auto-dispatch it. Verify by queuing two pending jobs and watching them run sequentially.

---

## 13. Cross-cutting UI checks (P2)

### 13.1 Status badge tones **(branch fix)**

Spot-check across all pages where job status appears:

| Status | Tone | Visual |
|---|---|---|
| `pending` | `info` | blue/teal |
| `running` | `info` | blue/teal |
| `cancelled` | `neutral` | grey/muted |
| `completed` | `success` | green |
| `failed` | `critical` | red |
| `scheduled` | `caution` | amber |
| `deactivated` | `warning` | orange |

Same expectations for store-credit job statuses and recipient statuses where applicable.

### 13.2 Sentence-case button labels **(branch fix)**

Spot-check the labels list (these are the ones that changed in this branch — confirm the rest of the app already uses sentence case):

| Where | Label |
|---|---|
| Job detail → usage error banner | `Try again` |
| Job detail → "No usage data" empty state | `Fetch usage data` |
| Job detail → usage refresh | `Refresh data` (or `Refresh (Xm Ys)` while cooldown) |
| Dashboard table bulk action | `Download selected` |
| Dashboard "Start creating" empty state | `Create gift cards` |
| Plan-limit / dashboard CTA | `Upgrade plan` |
| Job create page primary action | `Create gift cards` |
| Gift cards page primary action | `Create gift cards` |
| FAQ page CTA | `Contact support` |
| Subscriptions cancel-confirm modal | `Confirm downgrade` |
| Subscriptions current plan card button | `Current plan` |
| Onboarding modal step CTAs | `Start tour`, `Create gift cards`, `Learn more`, `View export options`, `View FAQ` |

### 13.3 Polaris web component sanity
- Polaris web components are noted as fragile in `CLAUDE.md`. Specifically watch for:
  - Buttons that don't fire on first click.
  - Tooltips (`s-tooltip`) that don't appear on hover.
  - Modal close behaviour after primary/secondary clicks.
  - Banner toasts persisting longer than expected.
  - Resource picker for customers (store credit) opening cleanly.

### 13.4 Accessibility spot-checks
- Tab through the main pages with keyboard only. Focus indicators visible? Order logical?
- Icon-only buttons announce sensibly (Cancel job, Retry job, Download job, Duplicate job, Deactivate gift cards, Resume job, Dismiss, Note: <content>).
- Disabled buttons (e.g. Resume during grace from server response — though we use 409 not disabled here) — N/A. Disabled buttons in forms should explain why they're disabled (e.g., "Submit" disabled with "Fix the errors above").

### 13.5 Localisation / language
- If the app supports any locale beyond English, switch the admin language and verify the extension's `t:name` titles and any localised strings render correctly. Skip if English-only.

---

## 14. Performance (P3)

### 14.1 Largest Contentful Paint (LCP)
- Open the app in an incognito window with the network throttled to "Fast 3G". Measure LCP via Chrome DevTools → Performance.
- **Expected target (Built for Shopify)**: ≤ 2.5s at p75. This is hard to measure manually but eyeball "does it feel fast?".

### 14.2 Long table behaviour
- If you have 100+ jobs, scroll the gift-cards table.
- **Expected**: No layout thrash, polling doesn't reset scroll, no JS errors.

### 14.3 Worker throughput
- Run a 1000-card job. Watch the worker stdout for steady progress and minimal retry chatter.
- **Expected**: Completes within a reasonable time given Shopify's API rate limits (rough order of magnitude: 1 card/sec).

---

## 15. Pre-push checklist

After running the priority tests above, verify:

- [ ] All P1 tests pass
- [ ] All **(branch fix)** tests pass
- [ ] No console errors during any flow (other than deliberate 409s from cooldown/lock tests)
- [ ] No new entries in the worker log indicating panics or unhandled errors
- [ ] DB advisory locks aren't held permanently when nothing's in flight: `SELECT * FROM pg_locks WHERE locktype='advisory';` is empty
- [ ] Redis isn't accumulating stale `job_status:*` keys for completed/cancelled jobs beyond the 24h TTL
- [ ] `npm run verify` (typecheck + lint + worker tests) is clean
- [ ] If the E2E suite is maintained for this branch: `npm run test:e2e` passes
- [ ] Any UI screenshots used for compliance review still reflect the current UI

When all the above are green, push:

```bash
git push origin dev
```

After pushing, delete this file (it's branch-specific):

```bash
rm docs/manual-test-plan.md
git add docs/manual-test-plan.md
git commit -m "chore: remove pre-push test plan"
git push origin dev
```

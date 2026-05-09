# Go-Live Plan: V1 → V2 Full Migration

## Current Infrastructure

| Component       | V1 (old)                                              | V2 (new)                                             |
|-----------------|-------------------------------------------------------|------------------------------------------------------|
| **Shopify app** | `e03ca549...` — "Datora \| Bulk Gift Cards"           | `43f55b21...` — "Datora \| Bulk Gift Cards V2"       |
| **App URL**     | `datora-gift-card-app-2777de0da91e.herokuapp.com`     | `datora-bulk-gift-cards.fly.dev`                     |
| **Database**    | Heroku Postgres                                       | Fly Managed Postgres (`datora-bulk-gift-cards-db`, ID `vmkq609p4vqo35ln`), fra |
| **Worker**      | Separate Fly app (`bulk-gift-card-go-service`, ewr)   | Embedded process in main Fly app (fra)               |
| **Redis**       | Upstash (`datora-bulk-gift-card-generator-redis`, ewr)| Upstash (`datora-gift-cards-redis`, fra)              |
| **API version** | `2023-10`                                             | `2026-01`                                            |
| **Scopes**      | `write_orders,write_products,write_gift_cards,read_customers` | `read_customers,read_gift_cards,write_customers,write_gift_card_transactions,write_gift_cards` |

## Schema Compatibility

V2 schema is a **strict superset** of V1. New fields are all nullable or have defaults:

- `User`: adds `autoDeactivateDays`, `slackWebhookUrl`
- `Job`: adds `jobType` (default `"create"`), `sourceJobId`, `deactivatedAt`
- `Session`: adds `firstName`, `lastName`, `email`, `accountOwner`, `locale`, `collaborator`, `emailVerified`, `refreshToken`, `refreshTokenExpires`

V1 data can be loaded into V2 schema without transformation.

## Extensions

V2 has 3 extensions (currently bound to V2 app listing `43f55b21...`):
- `send-gift-cards` — customer index selection action
- `send-gift-cards-segment` — customer segment action
- `support-link` — admin support link

V1 has **no extensions**. These are new features that will go live with the migration.

---

## Phase 1 — Preparation

- [x] ~~Verify `GIFT_CARD_ENCRYPTION_KEY` is identical between V1 and V2~~ — **Keys differ!** V1: `a3fcb9d6...66b8b`, V2: `fbc767fc...5132f`. At cutover, V2 must be switched to V1's key.
- [x] Create `shopify.app.v1-migration.toml` for V1's app listing with V2's config
- [ ] Prepare `shopify.app.v1-rollback.toml` with V1's original Heroku URLs (for emergency rollback)
- [ ] Test V2 end-to-end on datora-dev using V2's own app listing (as already done during development)
- [x] Dry-run the database migration — successful (2026-04-06):
  - `pg_dump --data-only --exclude-table=_prisma_migrations` from Heroku (144K lines)
  - Truncated Fly Postgres, imported V1 data
  - All 5 tables imported: 194 Presets, 8531 Jobs, 363 Sessions, 671 Users, 134308 gift_card_usage
  - V2 extra columns got correct defaults (`job_type=create`, nullables=null)

---

## Phase 2 — Database Migration

V2 schema is already deployed on Fly Postgres. Migration is data-only import (V1 and V2 have different Prisma migration histories, so full dump + `prisma migrate deploy` won't work).

- [ ] Put V1 into maintenance mode (or schedule during lowest-traffic window) to prevent writes during migration
- [ ] `pg_dump --data-only --exclude-table=_prisma_migrations` from Heroku
- [ ] `fly mpg proxy vmkq609p4vqo35ln` to connect to Fly Managed Postgres
- [ ] Truncate all tables via `psql` on `fly-db` (V2 schema stays intact)
- [ ] `psql < dump.sql` to import V1 data via the MPG proxy
- [ ] Verify data integrity — spot-check jobs, presets, gift card records, row counts

**Downtime**: Brief write-freeze during dump/restore. ~2 minutes based on dry-run.

---

## Phase 3 — Cutover

This is the switch. V1 stops, V2 takes over.

- [ ] Update V2's env vars on Fly:
  - `SHOPIFY_API_KEY` → V1's `client_id` (`e03ca549...`)
  - `SHOPIFY_API_SECRET` → V1's `api_secret` (`ffe28a2d...667e`)
  - `GIFT_CARD_ENCRYPTION_KEY` → V1's key (`a3fcb9d6...66b8b`)
- [ ] Redeploy V2 on Fly with the new env vars
- [ ] Run `shopify app deploy --config shopify.app.v1-migration.toml` to push to V1's app listing:
  - Updates `application_url` → V2's Fly URL
  - Updates `redirect_urls` → V2's auth callback
  - Registers V2's webhook subscriptions
  - Deploys all 3 extensions
  - Updates scopes declaration
- [ ] Verify the cutover:
  - [ ] Open datora-dev in Shopify admin — should load V2
  - [ ] OAuth flow works (existing session or re-auth)
  - [ ] Create a test gift card job — runs end-to-end
  - [ ] Webhooks arrive at V2
  - [ ] Extensions appear in customer index / segment pages

**Rollback**: See [Emergency Rollback Plan](#emergency-rollback-plan) below — ~2 minutes to revert.

---

## Emergency Rollback Plan

V1 Heroku app stays running for ~1 week after cutover. If V2 is badly failing, roll back fast.

### Rollback Triggers

Roll back immediately if any of:
- Gift card creation is failing for multiple shops
- OAuth/auth is broken — merchants can't open the app
- Data corruption or encryption errors (gift card codes unreadable)
- V2 is down and not recoverable within 10 minutes

### Fast Rollback Steps (~2 minutes)

Everything here reverts the app listing to point back at Heroku. V1 is still running, so this is instant.

1. **Revert app URLs** via Shopify CLI:

```bash
# From the V2 repo — deploy V1's original URLs back to the app listing
shopify app deploy --config shopify.app.v1-rollback.toml
```

`shopify.app.v1-rollback.toml` should be prepared **before** go-live with V1's original URLs:
- `application_url` → `https://datora-gift-card-app-2777de0da91e.herokuapp.com`
- `redirect_urls` → V1's auth callback

If the toml isn't ready, do it manually in Partner Dashboard:
- Go to Apps → "Datora | Bulk Gift Cards" → Configuration
- Set `App URL` back to Heroku URL
- Set `Allowed redirection URL(s)` back to Heroku callback
- Save

2. **Verify V1 is serving**:
   - Open `https://admin.shopify.com/store/app-store-apps-furkan/apps/bulk-gift-card-generator-1/app`
   - Confirm the app loads and a test job can be created

3. **No env var changes needed on Heroku** — V1 still has its original config

### Data Implications

- V1's Heroku database was **never modified** during migration — it has all data up to the cutover moment
- Any jobs created by merchants **after cutover while V2 was live** exist only on Fly Postgres — they will not appear in V1
- If V2 was live for only minutes, data loss is near-zero
- If V2 was live for hours, note which shops created jobs (query Fly DB) and handle manually after stabilizing

### Decision Window

| Time since cutover | Rollback complexity |
|---------------------|---------------------|
| < 1 hour | Clean — minimal/no new data on V2, roll back freely |
| 1–24 hours | Check Fly DB for new jobs first, note affected shops |
| > 24 hours | Significant new data on V2 only — rollback means data loss, consider fixing forward instead |

### After Rollback

- [ ] Confirm V1 is healthy (create a test job, check webhooks)
- [ ] Investigate what went wrong on V2
- [ ] Fix the issue, re-test on dev store
- [ ] Schedule a new cutover attempt

---

## Phase 4 — Monitoring & Cleanup

After cutover, keep V1 infra alive for ~1 week as a safety net.

### Monitor

- [ ] Error rates and logs on Fly
- [ ] Gift card creation success rate
- [ ] OAuth/session issues (watch for shops that need re-auth for new scopes)
- [ ] Webhook delivery
- [ ] Customer complaints

### Cleanup (after ~1 week stable)

- [ ] Shut down Heroku app
- [ ] Decommission `bulk-gift-card-go-service` on Fly (old worker)
- [ ] Decommission `datora-bulk-gift-card-generator-redis` on Upstash (old Redis, ewr)
- [ ] Decommission unmanaged `datora-gift-cards-db` Fly app (3 nodes — not used by V2, can be removed)
- [ ] Retire V2's app listing (`43f55b21...`) — no longer needed, V1 listing now runs V2 code

---

## Risks & Mitigations

### 1. Scope Changes
V2 drops `write_orders` and `write_products`, adds `write_customers` and `write_gift_card_transactions`. Existing shops keep old scopes until re-auth. V2 must handle missing scopes gracefully — detect and prompt re-auth when needed.

### 2. Region (ewr → fra)
Old infra was US East, new is Frankfurt. Adds ~100ms latency for US/Canada merchants. **Decision needed**: stick with `fra` or redeploy to a US region?

### 3. Encryption Key
`GIFT_CARD_ENCRYPTION_KEY` must be identical. Non-negotiable — verify before Phase 2.

### 4. Billing / Subscriptions
Recurring charges are tied to V1's `client_id`. Since we keep V1's app listing, subscriptions survive automatically.

### 5. API Version Jump (2023-10 → 2026-01)
Large version jump. Any breaking changes in Shopify's GraphQL API between these versions could affect existing shops. V2 has been developed against `2026-01`, so the code is compatible — but edge cases with older shop data are possible.

---

## Notes

### 2026-04-06 — Test Migration Findings

**Database identity confusion (critical)**:
There are TWO Fly Postgres instances — don't confuse them:
- **Unmanaged**: `datora-gift-cards-db` (Fly app, 3 nodes) — NOT used by V2
- **Managed (MPG)**: `datora-bulk-gift-cards-db` (ID `vmkq609p4vqo35ln`) — the ACTUAL V2 database

V2's `DATABASE_URL` is `postgresql://fly-user:...@pgbouncer.vmkq609p4vqo35ln.flympg.net/fly-db`.
Use `fly mpg proxy vmkq609p4vqo35ln` to connect, NOT `fly proxy -a datora-gift-cards-db`.

**Encryption keys differ**:
- V1: `a3fcb9d6feef7732c9d0a9153a207e45d2dbdb6e456e1a7cbf1bc92ee2a66b8b`
- V2: `fbc767fc15d123ed0cf441c43e99024cf22685dd3b8ec909b0499563e3d5132f`
- Must swap V2 to V1's key at cutover, otherwise V2 cannot decrypt migrated gift card codes

**Migration approach (validated)**:
- Full `pg_dump` won't work — V1 and V2 have completely different Prisma migration histories (V1: 37 migrations from 2023–2025, V2: 5 migrations starting 2026)
- Correct approach: `pg_dump --data-only --exclude-table=_prisma_migrations` → import into existing V2 schema
- V2 extra columns get defaults automatically (`job_type='create'`, nullable fields = null)
- Import takes ~2 minutes for full dataset (144K lines, 143K+ rows across 5 tables)

**Test migration result**:
V1 data successfully imported into V2's managed Postgres. V2 app shows all 17 jobs for datora-dev store. Data is live in V2 right now (test data — will be re-imported from fresh dump at actual cutover).

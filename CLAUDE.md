# CLAUDE.md

This file is the canonical guide for Claude Code in this repository.

## Project Overview

Datora Bulk Store Credits is a Shopify embedded app for bulk store credit issuance and management.
This repository was forked from `/Users/furkanulker/git/work/datora_gift_card_app_v2` so it shares the same
worker, queue, and bulk-job machinery; the product focus and marketing pivot to store credits.

Stack:
- React Router 7 web app in `app/`
- Polaris web components, not React Polaris
- Go worker in `services/worker/`
- Prisma for database access
- Redis for progress tracking and background queues

## Commands

```bash
# Local development
npm run dev

# Build and deploy
npm run build
npm run deploy

# Quality checks
npm run typecheck
npm run lint

# Prisma
npx prisma generate
npx prisma migrate dev
npx prisma migrate deploy

# Worker only
cd services/worker && go run ./cmd/worker/main.go
```

`npm run dev` runs `dev.sh`, which starts Redis, the Go worker, and `shopify app dev`.

## Architecture

Important pieces:
- `app/shopify.server.ts`: Shopify auth and Admin GraphQL setup
- `app/routes/app.tsx`: authenticated embedded app layout
- `app/routes/app._index.tsx`: dashboard
- `app/routes/app.job.create.tsx`: bulk job creation UI (store credit issuance)
- `app/routes/api.jobs.*`: job APIs
- `app/routes/webhooks.*`: webhook handlers
- `services/worker/`: async bulk-job worker

Important conventions:
- Shopify API version is `2026-01`
- Use Admin GraphQL, not REST
- Sensitive job payload fields are encrypted at rest
- Redis stores live job progress
- The app is embedded in Shopify admin

Note: this codebase is a fork of the gift card app, so many identifiers (routes, scopes,
encryption key name `GIFT_CARD_ENCRYPTION_KEY`, Go worker packages) still reference "gift card".
Renaming code identifiers is intentionally deferred — touch them as you migrate features to
store-credit semantics, not in a single sweep.

Planning docs:
- Rewrite implementation plan: `docs/rewrite-implementation-plan.md`

## Environment Variables

Core variables:
- `DATABASE_URL`
- `REDIS_URL`
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `WORKER_SERVICE_URL`
- `PRESHARED_AUTH_HEADER_KEY`
- `PRESHARED_AUTH_HEADER_VALUE`
- `GIFT_CARD_ENCRYPTION_KEY`

See `.env.example` for the full list, including SMTP settings.

## Embedded App Browser Testing

Shopify embedded app testing must happen inside the Shopify admin shell. Opening only the local tunnel URL is not enough for realistic testing because it skips the embedded iframe context and Shopify admin session.

### Recommended Auth Flow

1. Start the app locally:

```bash
npm run dev
```

2. Launch a real visible Chrome window with remote debugging enabled:

```bash
open -na "Google Chrome" --args \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-shopify-dev \
  "https://admin.shopify.com/store/app-store-apps-furkan/apps"
```

3. Let the human user complete Shopify login manually in that Chrome window.

4. Attach the automation agent to the logged-in browser:

```bash
agent-browser --cdp 9222 get url
agent-browser --cdp 9222 snapshot -i
```

5. Open or verify the embedded app inside Shopify admin. Dev app URL (for local development):

```text
TODO: set after creating the "Datora | Bulk Store Credits | Dev" Partner app and installing it on the dev store.
```

Production app URL (deployed):

```text
https://datora-bulk-store-credits.fly.dev
```

### Why This Flow

- Shopify auth often involves MFA and anti-bot checks
- Manual login keeps secrets out of agent prompts
- Reusing a real Chrome session is more reliable than scripted login
- CDP attach lets the agent test the actual embedded app UI

### Notes

- Prefer attaching to an already logged-in Chrome session with `--cdp 9222`
- `agent-browser open ...` without CDP may only open an internal automation session and not a visible desktop window
- If the browser is not visible, use the `open -na "Google Chrome" --args ...` command above instead of relying on `agent-browser --headed`
- Reuse `/tmp/chrome-shopify-dev` when you want to preserve the logged-in profile between runs

## Store and App Context

- Dev store: `app-store-apps-furkan.myshopify.com`
- Embedded app name: `Datora | Bulk Store Credits`
- Shopify config: `shopify.app.dev.toml` (dev), `shopify.app.prod.toml` (prod)
- Dev app URL: TODO — fill in after the dev Partner app is created
- Production app URL: https://datora-bulk-store-credits.fly.dev
- Sibling app for reference: `/Users/furkanulker/git/work/datora_gift_card_app_v2` (the gift card app this was forked from)

## Infrastructure

- Local dev orchestration lives in `dev.sh`
- Local Redis is started in Docker by `dev.sh`
- Deployment target is Fly.io
- CI/CD is handled with GitHub Actions

## Working Rules

- Preserve embedded-app behavior when making routing or navigation changes
- Prefer `Link` or Shopify-safe navigation patterns over raw `<a>` tags inside the app
- Be careful with auth flows, iframe behavior, and redirects
- Do not switch the app to REST API patterns
- **Polaris web components are fragile.** This app uses Polaris *web components* (custom elements / Shadow DOM), NOT React Polaris. They cause recurring issues: buttons not firing, elements not rendering, unexpected behavior. When making UI changes:
  - Always read existing component code before modifying — understand how events and slots are wired up
  - Make small, incremental UI changes rather than large rewrites
  - When something doesn't work, suspect the web component layer first (Shadow DOM event boundaries, element upgrade timing, attribute vs property binding)
  - Verify UI changes in the actual Shopify embedded app context, not just in isolation

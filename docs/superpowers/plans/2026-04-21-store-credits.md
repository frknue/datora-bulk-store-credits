# Store Credits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Store Credits MVP — a new top-level page in the Datora app that lets merchants bulk-issue Shopify store credit to a customer list with progress tracking, scheduling, and preflight warnings.

**Architecture:** New Prisma models (`StoreCreditJob`, `StoreCreditJobRecipient`), new API routes under `/app/store-credit/*` and `/api/store-credits/*`, new Go worker handler at `/run-store-credit-job` plus a scheduler loop, and a new nav entry. Kept fully separate from the existing gift-card pipeline (no shared Job model, no worker branching).

**Tech Stack:** React Router 7, Prisma 6, Polaris web components, Go 1.x worker, Redis for progress, Postgres for persistence, Shopify Admin GraphQL 2026-01.

**Spec:** `docs/superpowers/specs/2026-04-21-store-credits-design.md`

**Testing convention (matches existing codebase):**
- **Go worker code:** TDD — write a failing test, run it to see it fail, implement, run it to see it pass, commit.
- **TypeScript web code:** there is no JS/TS unit-test framework in this repo. Run `npm run typecheck` and `npm run lint` after each change. Manual verification in the embedded Shopify app at the end. Introducing vitest/jest is out of scope for this MVP.

**Working rules (from AGENTS.md):**
- Use Polaris web components, not React Polaris. They're fragile — read existing components before modifying.
- Admin GraphQL only, no REST.
- Shopify API version `2026-01`.
- Embedded app behavior must be preserved.

---

## Task 1: Prisma schema + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create (via `npx prisma migrate dev`): `prisma/migrations/<timestamp>_add_store_credit_jobs/migration.sql`

- [ ] **Step 1: Append the two new models to `prisma/schema.prisma`**

Append after the existing `GiftCardUsage` model (before `Session`):

```prisma
model StoreCreditJob {
  id                 String                    @id
  shopName           String                    @map("shop_name")
  userId             BigInt?                   @map("user_id")
  status             String                    @default("pending")
  amount             Decimal                   @db.Decimal(10, 2)
  currency           String
  expiresAt          DateTime?                 @map("expires_at")
  notify             Boolean                   @default(true)
  note               String?
  customerIds        String                    @map("customer_ids")
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
  customerId    String         @map("customer_id")
  accountId     String?        @map("account_id")
  transactionId String?        @map("transaction_id")
  status        String         @default("pending")
  errorMessage  String?        @map("error_message")
  processedAt   DateTime?      @map("processed_at")
  job           StoreCreditJob @relation(fields: [jobId], references: [id], onDelete: Cascade)

  @@index([jobId])
  @@index([customerId])
  @@map("store_credit_job_recipient")
}
```

- [ ] **Step 2: Generate the migration**

Run: `npx prisma migrate dev --name add_store_credit_jobs`
Expected: prompts you to apply; creates `prisma/migrations/<timestamp>_add_store_credit_jobs/migration.sql`, regenerates the Prisma client, exits 0.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: passes. If not, the generated Prisma client is out of sync — re-run `npx prisma generate`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(store-credit): add StoreCreditJob and StoreCreditJobRecipient models"
```

---

## Task 2: Add Shopify scopes to dev toml

**Files:**
- Modify: `shopify.app.dev.toml`

- [ ] **Step 1: Extend the `scopes` line**

Current line 34:

```toml
scopes = "read_customers,read_gift_cards,write_customers,write_gift_card_transactions,write_gift_cards"
```

Replace with:

```toml
scopes = "read_customers,read_gift_cards,write_customers,write_gift_card_transactions,write_gift_cards,read_store_credit_accounts,write_store_credit_account_transactions,read_store_credit_account_transactions"
```

- [ ] **Step 2: Commit**

```bash
git add shopify.app.dev.toml
git commit -m "feat(store-credit): add store credit scopes to dev toml"
```

**Note:** When the feature is ready to ship to production, promote the same scopes to `shopify.app.prod.toml`. Not part of the MVP implementation — that's a release-time step.

---

## Task 3: Shared validation & types

**Files:**
- Create: `shared/store-credit.ts`

- [ ] **Step 1: Write the shared module**

Create `shared/store-credit.ts`:

```ts
export const STORE_CREDIT_SUPPORTED_CURRENCIES = [
  "EUR",
  "USD",
  "GBP",
  "CAD",
  "AUD",
  "JPY",
] as const;

export type StoreCreditCurrency =
  (typeof STORE_CREDIT_SUPPORTED_CURRENCIES)[number];

export const STORE_CREDIT_RULES = {
  minAmount: 0.01,
  maxAmount: 100_000,
  noteMaxChars: 500,
  maxRecipientsPerJob: 10_000,
} as const;

export interface CreateStoreCreditJobBody {
  amount: string;
  currency: StoreCreditCurrency;
  customerIds: string | string[];
  note?: string;
  expireDate?: string;
  notify?: boolean;
  scheduledDate?: string;
  scheduledTime?: string;
  scheduledTimezone?: string;
  scheduledMessage?: string;
}

export function isSupportedStoreCreditCurrency(
  value: string,
): value is StoreCreditCurrency {
  return (STORE_CREDIT_SUPPORTED_CURRENCIES as readonly string[]).includes(
    value,
  );
}

export interface StoreCreditValidationError {
  field: string;
  message: string;
}

export function validateCreateStoreCreditJobInput(
  input: CreateStoreCreditJobBody,
): StoreCreditValidationError[] {
  const errors: StoreCreditValidationError[] = [];

  const amountNum = Number(input.amount);
  if (!input.amount || Number.isNaN(amountNum)) {
    errors.push({ field: "amount", message: "Amount is required" });
  } else if (amountNum < STORE_CREDIT_RULES.minAmount) {
    errors.push({
      field: "amount",
      message: `Amount must be at least ${STORE_CREDIT_RULES.minAmount}`,
    });
  } else if (amountNum > STORE_CREDIT_RULES.maxAmount) {
    errors.push({
      field: "amount",
      message: `Amount must be at most ${STORE_CREDIT_RULES.maxAmount}`,
    });
  }

  if (!input.currency || !isSupportedStoreCreditCurrency(input.currency)) {
    errors.push({
      field: "currency",
      message: "Unsupported currency",
    });
  }

  const customerIdList = Array.isArray(input.customerIds)
    ? input.customerIds
    : (input.customerIds || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);

  if (customerIdList.length === 0) {
    errors.push({
      field: "customerIds",
      message: "At least one recipient is required",
    });
  } else if (customerIdList.length > STORE_CREDIT_RULES.maxRecipientsPerJob) {
    errors.push({
      field: "customerIds",
      message: `No more than ${STORE_CREDIT_RULES.maxRecipientsPerJob} recipients per job`,
    });
  }

  if (input.note && input.note.length > STORE_CREDIT_RULES.noteMaxChars) {
    errors.push({
      field: "note",
      message: `Note must be ${STORE_CREDIT_RULES.noteMaxChars} characters or fewer`,
    });
  }

  return errors;
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint:shared`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add shared/store-credit.ts
git commit -m "feat(store-credit): add shared validation and types"
```

---

## Task 4: Web service — create job

**Files:**
- Create: `app/lib/services/store-credit.server.ts`

- [ ] **Step 1: Write the service module**

Read `app/lib/services/create-job.server.ts` first for the existing patterns (timezone parsing, plan limits, customer-ID extraction). Reuse them verbatim where possible.

Create `app/lib/services/store-credit.server.ts`:

```ts
import { DateTime } from "luxon";
import prisma from "../../db.server";
import {
  canRunJobsWithPlan,
  getPlanFromBilling,
} from "../../services/plan.server";
import {
  STORE_CREDIT_SUPPORTED_CURRENCIES,
  STORE_CREDIT_RULES,
  validateCreateStoreCreditJobInput,
  type CreateStoreCreditJobBody,
  type StoreCreditCurrency,
} from "../../../shared/store-credit";
import { triggerStoreCreditJob } from "./worker-trigger.server";
import type { authenticate } from "../../shopify.server";

type AdminAuthContext = Awaited<ReturnType<typeof authenticate.admin>>;
type BillingContext = AdminAuthContext["billing"];
type SessionContext = AdminAuthContext["session"];

interface CreateStoreCreditJobResult {
  body: {
    message: string;
    jobId?: string;
    status?: string;
  };
  status: number;
}

interface ScheduledTimestampResult {
  scheduledTimestamp?: string;
  error?: string;
}

function buildErrorResult(
  message: string,
  status = 400,
): CreateStoreCreditJobResult {
  return { body: { message }, status };
}

function hasAccessScope(
  scopeString: string | null | undefined,
  requiredScope: string,
): boolean {
  if (!scopeString) return false;
  return scopeString
    .split(",")
    .map((s) => s.trim())
    .includes(requiredScope);
}

function extractNumericId(gid: string): string {
  const match = gid.match(/(\d+)$/);
  return match ? match[1] : gid;
}

function isOffsetTimezone(tz: string): boolean {
  return /^[+-]\d{2}:\d{2}$/.test(tz) || tz === "00:00";
}

function resolveTimezone(tz: string): string {
  if (tz === "00:00") return "UTC";
  if (isOffsetTimezone(tz)) return `UTC${tz}`;
  return tz;
}

function parseScheduledTimestamp(
  date?: string,
  time?: string,
  timezone?: string,
): ScheduledTimestampResult {
  if (!date || !time || !timezone) return {};
  try {
    const dt = DateTime.fromISO(`${date}T${time}:00`, {
      zone: resolveTimezone(timezone),
    });
    const iso = dt.toUTC().toISO();
    if (!iso) {
      return { error: "Invalid scheduled delivery date, time, or timezone" };
    }
    const scheduled = new Date(iso);
    const now = new Date();
    if (scheduled <= now) {
      return { error: "Scheduled delivery time must be in the future" };
    }
    const ninetyDays = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    if (scheduled > ninetyDays) {
      return { error: "Scheduled delivery time must be within 90 days" };
    }
    return { scheduledTimestamp: iso };
  } catch (e) {
    console.error("Error parsing scheduled time:", e);
    return { error: "Invalid scheduled delivery date, time, or timezone" };
  }
}

export async function createStoreCreditJob(
  billing: BillingContext,
  session: SessionContext,
  body: CreateStoreCreditJobBody,
): Promise<CreateStoreCreditJobResult> {
  const validationErrors = validateCreateStoreCreditJobInput(body);
  if (validationErrors.length > 0) {
    return buildErrorResult(validationErrors[0].message);
  }

  if (!hasAccessScope(session.scope, "write_store_credit_account_transactions")) {
    return buildErrorResult(
      "Issuing store credit requires the Shopify write_store_credit_account_transactions scope. Reinstall or reauthorize the app, then try again.",
      403,
    );
  }

  if (body.expireDate) {
    const exp = new Date(`${body.expireDate}T23:59:59.999`);
    if (Number.isNaN(exp.getTime()) || exp <= new Date()) {
      return buildErrorResult("Expire date must be in the future");
    }
  }

  const hasSchedulingFields = Boolean(
    body.scheduledDate ||
      body.scheduledTime ||
      body.scheduledTimezone ||
      body.scheduledMessage,
  );

  if (
    hasSchedulingFields &&
    (!body.scheduledDate || !body.scheduledTime || !body.scheduledTimezone)
  ) {
    return buildErrorResult(
      "Scheduled date, time, and timezone are all required",
    );
  }

  const { scheduledTimestamp, error: scheduleError } = parseScheduledTimestamp(
    body.scheduledDate,
    body.scheduledTime,
    body.scheduledTimezone,
  );

  if (scheduleError) return buildErrorResult(scheduleError);

  const plan = await getPlanFromBilling(billing, session.shop);

  const activeJobCount = await prisma.storeCreditJob.count({
    where: {
      shopName: session.shop,
      status: { in: ["pending", "running"] },
    },
  });

  if (!canRunJobsWithPlan(plan, activeJobCount)) {
    return buildErrorResult(
      `Your ${plan.name} plan allows ${plan.jobs} running job(s) at once. Please wait for an active job to finish.`,
    );
  }

  const rawIds = Array.isArray(body.customerIds)
    ? body.customerIds
    : (body.customerIds || "").split(",");
  const numericIds = rawIds
    .map((id) => extractNumericId(String(id).trim()))
    .filter(Boolean);

  if (numericIds.length === 0) {
    return buildErrorResult("At least one valid customer ID is required");
  }

  if (numericIds.length > STORE_CREDIT_RULES.maxRecipientsPerJob) {
    return buildErrorResult(
      `No more than ${STORE_CREDIT_RULES.maxRecipientsPerJob} recipients per job`,
    );
  }

  const customerIdString = numericIds.join(",");
  const jobId = crypto.randomUUID();
  const notify = body.notify !== false;

  await prisma.storeCreditJob.create({
    data: {
      id: jobId,
      shopName: session.shop,
      userId: session.onlineAccessInfo?.associated_user?.id
        ? BigInt(session.onlineAccessInfo.associated_user.id)
        : null,
      status: scheduledTimestamp ? "scheduled" : "pending",
      amount: body.amount,
      currency: body.currency as StoreCreditCurrency,
      expiresAt: body.expireDate
        ? new Date(`${body.expireDate}T23:59:59.999Z`)
        : null,
      notify,
      note: body.note?.trim() || null,
      customerIds: customerIdString,
      count: numericIds.length,
      scheduledDate: body.scheduledDate || null,
      scheduledTime: body.scheduledTime || null,
      scheduledTimezone: body.scheduledTimezone || null,
      scheduledTimestamp: scheduledTimestamp || null,
      scheduledMessage: body.scheduledMessage || null,
    },
  });

  if (!scheduledTimestamp) {
    try {
      await triggerStoreCreditJob(jobId, session.shop);
    } catch (e) {
      console.error("Error triggering worker for store credit job:", jobId, e);
      await prisma.storeCreditJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          errorMessage: "Failed to reach worker service. Please retry the job.",
        },
      });
      return buildErrorResult(
        "Job was created but the worker service is unreachable. The job has been marked as failed — you can retry it from the job details page.",
        503,
      );
    }
  }

  return {
    body: {
      message: "Store credit job created",
      jobId,
      status: scheduledTimestamp ? "scheduled" : "pending",
    },
    status: 201,
  };
}
```

**Note:** `triggerStoreCreditJob` does not exist yet — it's created in Task 6. Typecheck will fail after this step; that's fine and expected.

- [ ] **Step 2: Commit (partial — typecheck will fail until Task 6)**

```bash
git add app/lib/services/store-credit.server.ts
git commit -m "feat(store-credit): add createStoreCreditJob service"
```

---

## Task 5: Web service — progress & history queries

**Files:**
- Modify: `app/lib/services/store-credit.server.ts`

- [ ] **Step 1: Append progress and history helpers**

Append to `app/lib/services/store-credit.server.ts`:

```ts
import redisClient from "../../redis.server";

export interface StoreCreditJobProgress {
  jobId: string;
  done: number;
  total: number;
  status: string;
}

export async function getStoreCreditJobsProgress(
  jobIds: string[],
): Promise<StoreCreditJobProgress[]> {
  const out: StoreCreditJobProgress[] = [];
  for (const jobId of jobIds) {
    try {
      const hash = await redisClient.hgetall(`store_credit_job_status:${jobId}`);
      if (hash && Object.keys(hash).length > 0) {
        out.push({
          jobId,
          done: parseInt(hash.done || "0", 10),
          total: parseInt(hash.total || "0", 10),
          status: hash.status || "unknown",
        });
        continue;
      }
      const row = await prisma.storeCreditJob.findFirst({
        where: { id: jobId },
        select: { status: true, done: true, count: true },
      });
      if (row) {
        out.push({
          jobId,
          done: row.done,
          total: row.count,
          status: row.status,
        });
      } else {
        out.push({ jobId, done: 0, total: 0, status: "unknown" });
      }
    } catch (e) {
      console.error(`Error fetching progress for store credit job ${jobId}:`, e);
      out.push({ jobId, done: 0, total: 0, status: "error" });
    }
  }
  return out;
}

export async function listStoreCreditJobsForShop(
  shopName: string,
  limit = 50,
) {
  return prisma.storeCreditJob.findMany({
    where: { shopName },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getStoreCreditJobWithRecipients(
  shopName: string,
  jobId: string,
) {
  return prisma.storeCreditJob.findFirst({
    where: { id: jobId, shopName },
    include: {
      recipients: {
        orderBy: { processedAt: "asc" },
        take: 50,
      },
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/lib/services/store-credit.server.ts
git commit -m "feat(store-credit): add progress and history query helpers"
```

---

## Task 6: Web service — worker trigger

**Files:**
- Modify: `app/lib/services/worker-trigger.server.ts`

- [ ] **Step 1: Add `triggerStoreCreditJob` alongside the existing `triggerWorkerJob`**

Append to `app/lib/services/worker-trigger.server.ts`:

```ts
export async function triggerStoreCreditJob(
  jobId: string,
  shopName: string,
): Promise<boolean> {
  const workerUrl = process.env.WORKER_SERVICE_URL;

  if (!workerUrl) {
    throw new Error("WORKER_SERVICE_URL is not configured");
  }

  const url = `${workerUrl}/run-store-credit-job?id=${jobId}&shop=${shopName}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [process.env.PRESHARED_AUTH_HEADER_KEY || "X-Custom-PSK"]:
      process.env.PRESHARED_AUTH_HEADER_VALUE || "",
  };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_TRIGGER_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) return true;

      if (response.status >= 400 && response.status < 500) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Worker rejected store credit job ${jobId}: ${response.status} ${body}`.trim(),
        );
      }

      lastError = new Error(
        `Worker returned ${response.status} for store credit job ${jobId}`,
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError.message.includes("Worker rejected")) throw lastError;
    }

    if (attempt < MAX_TRIGGER_RETRIES - 1) {
      const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError ?? new Error(`Failed to trigger worker for store credit job ${jobId}`);
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes now (the reference from Task 4 resolves).

- [ ] **Step 3: Commit**

```bash
git add app/lib/services/worker-trigger.server.ts
git commit -m "feat(store-credit): add triggerStoreCreditJob worker trigger"
```

---

## Task 7: Web API — create action

**Files:**
- Create: `app/routes/api.store-credits.create.ts`

- [ ] **Step 1: Write the action route**

```ts
import { authenticate } from "../shopify.server";
import { createStoreCreditJob } from "../lib/services/store-credit.server";
import type { CreateStoreCreditJobBody } from "../../shared/store-credit";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { cors } = await authenticate.admin(request);
  return cors(Response.json({ message: "Method not allowed" }, { status: 405 }));
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, cors, session } = await authenticate.admin(request);

  if (request.method !== "POST") {
    return cors(Response.json({ message: "Method not allowed" }, { status: 405 }));
  }

  const body: CreateStoreCreditJobBody = await request.json();
  const result = await createStoreCreditJob(billing, session, body);

  return cors(Response.json(result.body, { status: result.status }));
};
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint:app`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add app/routes/api.store-credits.create.ts
git commit -m "feat(store-credit): add POST /api/store-credits/create action"
```

---

## Task 8: Web API — progress loader

**Files:**
- Create: `app/routes/api.store-credits.progress.ts`

- [ ] **Step 1: Write the loader**

```ts
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getStoreCreditJobsProgress } from "../lib/services/store-credit.server";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const jobIds = (url.searchParams.get("ids") || "").split(",").filter(Boolean);

  if (jobIds.length === 0) return [];

  const owned = await prisma.storeCreditJob.findMany({
    where: { id: { in: jobIds }, shopName: session.shop },
    select: { id: true },
  });
  const ownedIds = owned.map((j) => j.id);
  if (ownedIds.length === 0) return [];

  return await getStoreCreditJobsProgress(ownedIds);
};
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint:app`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add app/routes/api.store-credits.progress.ts
git commit -m "feat(store-credit): add GET /api/store-credits/progress loader"
```

---

## Task 9: Go worker — DB helpers (TDD)

**Files:**
- Create: `services/worker/internal/db/store_credit.go`
- Create: `services/worker/internal/db/store_credit_test.go`

- [ ] **Step 1: Read the existing `services/worker/internal/db/db.go` to see the `ClaimJob`, `FetchJob`, `JobStatusRunning` patterns.** You will mirror those patterns for store credit jobs.

- [ ] **Step 2: Write the failing test**

Create `services/worker/internal/db/store_credit_test.go`:

```go
package db

import "testing"

func TestStoreCreditJobStatusConstants(t *testing.T) {
	cases := map[StoreCreditJobStatus]string{
		StoreCreditJobStatusPending:              "pending",
		StoreCreditJobStatusScheduled:            "scheduled",
		StoreCreditJobStatusRunning:              "running",
		StoreCreditJobStatusCompleted:            "completed",
		StoreCreditJobStatusCompletedWithErrors:  "completed_with_errors",
		StoreCreditJobStatusFailed:               "failed",
	}
	for status, want := range cases {
		if string(status) != want {
			t.Errorf("status %q = %q, want %q", status, string(status), want)
		}
	}
}

func TestStoreCreditRecipientStatusConstants(t *testing.T) {
	cases := map[StoreCreditRecipientStatus]string{
		StoreCreditRecipientStatusPending:   "pending",
		StoreCreditRecipientStatusSucceeded: "succeeded",
		StoreCreditRecipientStatusFailed:    "failed",
	}
	for s, want := range cases {
		if string(s) != want {
			t.Errorf("recipient status %q = %q, want %q", s, string(s), want)
		}
	}
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd services/worker && go test ./internal/db/ -run StoreCredit -v`
Expected: FAIL with "undefined: StoreCreditJobStatus..."

- [ ] **Step 4: Write the implementation**

Create `services/worker/internal/db/store_credit.go`:

```go
package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

type StoreCreditJobStatus string
type StoreCreditRecipientStatus string

const (
	StoreCreditJobStatusPending             StoreCreditJobStatus = "pending"
	StoreCreditJobStatusScheduled           StoreCreditJobStatus = "scheduled"
	StoreCreditJobStatusRunning             StoreCreditJobStatus = "running"
	StoreCreditJobStatusCompleted           StoreCreditJobStatus = "completed"
	StoreCreditJobStatusCompletedWithErrors StoreCreditJobStatus = "completed_with_errors"
	StoreCreditJobStatusFailed              StoreCreditJobStatus = "failed"

	StoreCreditRecipientStatusPending   StoreCreditRecipientStatus = "pending"
	StoreCreditRecipientStatusSucceeded StoreCreditRecipientStatus = "succeeded"
	StoreCreditRecipientStatusFailed    StoreCreditRecipientStatus = "failed"
)

type StoreCreditJob struct {
	ID                 string
	ShopName           string
	Status             string
	Amount             string
	Currency           string
	ExpiresAt          sql.NullTime
	Notify             bool
	CustomerIDs        string
	Count              int
	Done               int
	Failed             int
	ScheduledTimestamp sql.NullString
	CreatedAt          time.Time
}

// ErrStoreCreditJobNotClaimable indicates the job is already running, completed, or failed.
var ErrStoreCreditJobNotClaimable = errors.New("store credit job not claimable")

// FetchStoreCreditJob returns the job row by ID.
func FetchStoreCreditJob(ctx context.Context, db *sql.DB, id string) (*StoreCreditJob, error) {
	row := db.QueryRowContext(ctx, `
		SELECT id, shop_name, status, amount, currency, expires_at, notify,
		       customer_ids, count, done, failed, scheduled_timestamp, created_at
		FROM store_credit_job
		WHERE id = $1
	`, id)

	job := &StoreCreditJob{}
	if err := row.Scan(
		&job.ID, &job.ShopName, &job.Status, &job.Amount, &job.Currency,
		&job.ExpiresAt, &job.Notify, &job.CustomerIDs, &job.Count, &job.Done,
		&job.Failed, &job.ScheduledTimestamp, &job.CreatedAt,
	); err != nil {
		return nil, fmt.Errorf("fetch store credit job: %w", err)
	}
	return job, nil
}

// ClaimStoreCreditJob atomically moves a job from pending/scheduled to running.
// Returns ErrStoreCreditJobNotClaimable if the job has a different status.
func ClaimStoreCreditJob(ctx context.Context, db *sql.DB, id string) (*StoreCreditJob, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin claim tx: %w", err)
	}
	defer tx.Rollback()

	var status string
	if err := tx.QueryRowContext(ctx,
		`UPDATE store_credit_job SET status = 'running'
		 WHERE id = $1 AND status IN ('pending','scheduled')
		 RETURNING status`, id,
	).Scan(&status); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrStoreCreditJobNotClaimable
		}
		return nil, fmt.Errorf("claim store credit job: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit claim: %w", err)
	}

	return FetchStoreCreditJob(ctx, db, id)
}

// InsertStoreCreditRecipients inserts one row per customer ID with status='pending'.
// customerIDs are numeric Shopify Customer IDs (strings).
func InsertStoreCreditRecipients(ctx context.Context, db *sql.DB, jobID string, customerIDs []string) error {
	if len(customerIDs) == 0 {
		return nil
	}
	args := make([]interface{}, 0, len(customerIDs)*2)
	placeholders := ""
	for i, cid := range customerIDs {
		if i > 0 {
			placeholders += ","
		}
		placeholders += fmt.Sprintf("(gen_random_uuid(), $%d, $%d, 'pending')", 2*i+1, 2*i+2)
		args = append(args, jobID, cid)
	}
	q := fmt.Sprintf(`
		INSERT INTO store_credit_job_recipient (id, job_id, customer_id, status)
		VALUES %s
	`, placeholders)
	if _, err := db.ExecContext(ctx, q, args...); err != nil {
		return fmt.Errorf("insert recipients: %w", err)
	}
	return nil
}

// MarkStoreCreditRecipientSucceeded updates the recipient and increments the parent's done counter.
func MarkStoreCreditRecipientSucceeded(
	ctx context.Context, db *sql.DB,
	jobID, customerID, accountID, transactionID string,
) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		UPDATE store_credit_job_recipient
		SET status='succeeded', account_id=$1, transaction_id=$2, processed_at=NOW()
		WHERE job_id=$3 AND customer_id=$4 AND status='pending'
	`, accountID, transactionID, jobID, customerID); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE store_credit_job SET done = done + 1 WHERE id=$1
	`, jobID); err != nil {
		return err
	}

	return tx.Commit()
}

// MarkStoreCreditRecipientFailed updates the recipient and increments the parent's failed counter.
func MarkStoreCreditRecipientFailed(
	ctx context.Context, db *sql.DB,
	jobID, customerID, errorMessage string,
) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		UPDATE store_credit_job_recipient
		SET status='failed', error_message=$1, processed_at=NOW()
		WHERE job_id=$2 AND customer_id=$3 AND status='pending'
	`, errorMessage, jobID, customerID); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE store_credit_job SET failed = failed + 1 WHERE id=$1
	`, jobID); err != nil {
		return err
	}

	return tx.Commit()
}

// FinalizeStoreCreditJob sets the final status and finished_at. Must be called with the final
// done and failed counts; it derives status from them.
func FinalizeStoreCreditJob(ctx context.Context, db *sql.DB, jobID string) error {
	var count, done, failed int
	if err := db.QueryRowContext(ctx, `
		SELECT count, done, failed FROM store_credit_job WHERE id=$1
	`, jobID).Scan(&count, &done, &failed); err != nil {
		return fmt.Errorf("fetch counters: %w", err)
	}

	var status StoreCreditJobStatus
	switch {
	case done == count:
		status = StoreCreditJobStatusCompleted
	case done > 0:
		status = StoreCreditJobStatusCompletedWithErrors
	default:
		status = StoreCreditJobStatusFailed
	}

	if _, err := db.ExecContext(ctx, `
		UPDATE store_credit_job SET status=$1, finished_at=NOW() WHERE id=$2
	`, string(status), jobID); err != nil {
		return fmt.Errorf("finalize: %w", err)
	}
	return nil
}

// ListDueScheduledStoreCreditJobs returns scheduled jobs whose timestamp has passed.
func ListDueScheduledStoreCreditJobs(ctx context.Context, db *sql.DB, limit int) ([]StoreCreditJob, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT id, shop_name FROM store_credit_job
		WHERE status='scheduled' AND scheduled_timestamp <= NOW()::text
		ORDER BY scheduled_timestamp ASC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []StoreCreditJob
	for rows.Next() {
		j := StoreCreditJob{}
		if err := rows.Scan(&j.ID, &j.ShopName); err != nil {
			return nil, err
		}
		out = append(out, j)
	}
	return out, rows.Err()
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd services/worker && go test ./internal/db/ -run StoreCredit -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add services/worker/internal/db/store_credit.go services/worker/internal/db/store_credit_test.go
git commit -m "feat(store-credit): add worker DB helpers for store credit jobs"
```

---

## Task 10: Go worker — Shopify mutation wrapper (TDD)

**Files:**
- Create: `services/worker/internal/shopify/store_credit.go`
- Create: `services/worker/internal/shopify/store_credit_test.go`

- [ ] **Step 1: Read `services/worker/internal/shopify/shopify.go`** to understand how `shopifyClient`, `executeGraphQL` (or the equivalent), and the `utils.ShopifyAuthTokenFor(...)` helper work. Mirror the existing request-building pattern.

- [ ] **Step 2: Write the failing test**

Create `services/worker/internal/shopify/store_credit_test.go`:

```go
package shopify

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestBuildStoreCreditVariables_WithExpiry(t *testing.T) {
	vars := buildStoreCreditVariables("gid://shopify/Customer/123", "25.00", "USD", "2028-12-31T00:00:00Z", true)

	raw, err := json.Marshal(vars)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	s := string(raw)
	for _, want := range []string{
		`"id":"gid://shopify/Customer/123"`,
		`"amount":"25.00"`,
		`"currencyCode":"USD"`,
		`"expiresAt":"2028-12-31T00:00:00Z"`,
		`"notify":true`,
	} {
		if !strings.Contains(s, want) {
			t.Errorf("vars missing %q in %s", want, s)
		}
	}
}

func TestBuildStoreCreditVariables_NoExpiry(t *testing.T) {
	vars := buildStoreCreditVariables("gid://shopify/Customer/123", "25.00", "USD", "", false)
	raw, _ := json.Marshal(vars)
	s := string(raw)
	if strings.Contains(s, "expiresAt") {
		t.Errorf("expected no expiresAt key, got %s", s)
	}
	if !strings.Contains(s, `"notify":false`) {
		t.Errorf("expected notify=false, got %s", s)
	}
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd services/worker && go test ./internal/shopify/ -run StoreCredit -v`
Expected: FAIL with "undefined: buildStoreCreditVariables"

- [ ] **Step 4: Write the implementation**

Create `services/worker/internal/shopify/store_credit.go`:

```go
package shopify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
)

const storeCreditAccountCreditMutation = `
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
`

// StoreCreditResult captures the relevant fields for persisting.
type StoreCreditResult struct {
	AccountID     string
	TransactionID string
}

// StoreCreditUserError mirrors the Shopify userErrors payload.
type StoreCreditUserError struct {
	Field   []string `json:"field"`
	Message string   `json:"message"`
}

func buildStoreCreditVariables(
	customerGID, amount, currency, expiresAt string, notify bool,
) map[string]interface{} {
	credit := map[string]interface{}{
		"creditAmount": map[string]string{
			"amount":       amount,
			"currencyCode": currency,
		},
		"notify": notify,
	}
	if expiresAt != "" {
		credit["expiresAt"] = expiresAt
	}
	return map[string]interface{}{
		"id":          customerGID,
		"creditInput": credit,
	}
}

// IssueStoreCredit calls the storeCreditAccountCredit mutation for a single customer.
// accessToken: offline Shopify token for the shop.
// customerGID: full gid://shopify/Customer/NNN form.
// amount: decimal string, e.g. "25.00".
// currency: ISO 4217 code.
// expiresAt: RFC3339 string or "".
func IssueStoreCredit(
	ctx context.Context,
	shopDomain, accessToken, customerGID, amount, currency, expiresAt string,
	notify bool,
) (*StoreCreditResult, []StoreCreditUserError, error) {
	apiVersion := os.Getenv("SHOPIFY_API_VERSION")
	if apiVersion == "" {
		apiVersion = "2026-01"
	}
	url := fmt.Sprintf("https://%s/admin/api/%s/graphql.json", shopDomain, apiVersion)

	body := map[string]interface{}{
		"query":     storeCreditAccountCreditMutation,
		"variables": buildStoreCreditVariables(customerGID, amount, currency, expiresAt, notify),
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, nil, fmt.Errorf("marshal: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(raw))
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Shopify-Access-Token", accessToken)

	resp, err := shopifyClient.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("http: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, fmt.Errorf("read body: %w", err)
	}

	if resp.StatusCode >= 500 {
		return nil, nil, fmt.Errorf("shopify 5xx: %d %s", resp.StatusCode, string(respBody))
	}
	if resp.StatusCode == 429 {
		return nil, nil, fmt.Errorf("shopify rate limited: %s", string(respBody))
	}
	if resp.StatusCode >= 400 {
		return nil, nil, fmt.Errorf("shopify %d: %s", resp.StatusCode, string(respBody))
	}

	var parsed struct {
		Data struct {
			StoreCreditAccountCredit struct {
				StoreCreditAccountTransaction *struct {
					ID      string `json:"id"`
					Account struct {
						ID string `json:"id"`
					} `json:"account"`
				} `json:"storeCreditAccountTransaction"`
				UserErrors []StoreCreditUserError `json:"userErrors"`
			} `json:"storeCreditAccountCredit"`
		} `json:"data"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return nil, nil, fmt.Errorf("decode: %w", err)
	}

	payload := parsed.Data.StoreCreditAccountCredit
	if len(payload.UserErrors) > 0 {
		return nil, payload.UserErrors, nil
	}
	if payload.StoreCreditAccountTransaction == nil {
		return nil, nil, fmt.Errorf("unexpected empty transaction in response: %s", string(respBody))
	}

	return &StoreCreditResult{
		AccountID:     payload.StoreCreditAccountTransaction.Account.ID,
		TransactionID: payload.StoreCreditAccountTransaction.ID,
	}, nil, nil
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd services/worker && go test ./internal/shopify/ -run StoreCredit -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add services/worker/internal/shopify/store_credit.go services/worker/internal/shopify/store_credit_test.go
git commit -m "feat(store-credit): add storeCreditAccountCredit mutation wrapper"
```

---

## Task 11: Go worker — handler with retry (TDD where practical)

**Files:**
- Create: `services/worker/internal/handler/store_credit_handler.go`
- Create: `services/worker/internal/handler/store_credit_handler_test.go`

- [ ] **Step 1: Read `services/worker/internal/handler/handler.go`** to see how `RunJobHandler` wires env vars, the semaphore, Redis, PSK middleware, and per-recipient retry/backoff for the gift-card flow. The store-credit handler mirrors that shape.

- [ ] **Step 2: Write the failing test for status derivation logic**

Create `services/worker/internal/handler/store_credit_handler_test.go`:

```go
package handler

import "testing"

func TestDeriveFinalStoreCreditStatus(t *testing.T) {
	cases := []struct {
		count, done, failed int
		want                string
	}{
		{10, 10, 0, "completed"},
		{10, 7, 3, "completed_with_errors"},
		{10, 0, 10, "failed"},
		{5, 0, 0, "failed"},
	}
	for _, c := range cases {
		got := deriveFinalStoreCreditStatus(c.count, c.done, c.failed)
		if got != c.want {
			t.Errorf("deriveFinalStoreCreditStatus(%d,%d,%d) = %q, want %q",
				c.count, c.done, c.failed, got, c.want)
		}
	}
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd services/worker && go test ./internal/handler/ -run DeriveFinalStoreCredit -v`
Expected: FAIL with "undefined: deriveFinalStoreCreditStatus"

- [ ] **Step 4: Write the handler implementation**

Create `services/worker/internal/handler/store_credit_handler.go`:

```go
package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/Datora-Websystems/datora-bulk-gift-cards/services/worker/internal/db"
	"github.com/Datora-Websystems/datora-bulk-gift-cards/services/worker/internal/shopify"
	"github.com/go-redis/redis/v8"
)

const (
	storeCreditMaxRetries       = 3
	storeCreditRetryBaseBackoff = 500 * time.Millisecond
)

func deriveFinalStoreCreditStatus(count, done, failed int) string {
	if done == count {
		return "completed"
	}
	if done > 0 {
		return "completed_with_errors"
	}
	return "failed"
}

// RunStoreCreditJobHandler is the HTTP entry point invoked by the web layer via
// triggerStoreCreditJob. It claims the job and kicks off processing in a goroutine.
func RunStoreCreditJobHandler(w http.ResponseWriter, r *http.Request) {
	jobID := r.URL.Query().Get("id")
	shop := r.URL.Query().Get("shop")
	if jobID == "" || shop == "" {
		http.Error(w, "id and shop are required", http.StatusBadRequest)
		return
	}

	dbURL := NormalizeDatabaseURL(os.Getenv("DATABASE_URL"))
	sqlDB, err := sql.Open("postgres", dbURL)
	if err != nil {
		http.Error(w, fmt.Sprintf("db open: %v", err), http.StatusInternalServerError)
		return
	}

	// Idempotency: if job is already past pending/scheduled, return 200 and close the DB.
	existing, err := db.FetchStoreCreditJob(r.Context(), sqlDB, jobID)
	if err != nil {
		sqlDB.Close()
		http.Error(w, fmt.Sprintf("fetch: %v", err), http.StatusNotFound)
		return
	}
	if existing.Status != string(db.StoreCreditJobStatusPending) &&
		existing.Status != string(db.StoreCreditJobStatusScheduled) {
		sqlDB.Close()
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"already_processed"}`))
		return
	}

	select {
	case jobSemaphore <- struct{}{}:
	default:
		sqlDB.Close()
		http.Error(w, "worker busy", http.StatusTooManyRequests)
		return
	}

	go func() {
		defer func() { <-jobSemaphore }()
		defer sqlDB.Close()
		ctx := context.Background()
		if err := processStoreCreditJob(ctx, sqlDB, jobID, shop); err != nil {
			log.Printf("store credit job %s failed: %v", jobID, err)
		}
	}()

	w.WriteHeader(http.StatusAccepted)
	_, _ = w.Write([]byte(`{"status":"accepted"}`))
}

// processStoreCreditJob performs the full job lifecycle.
// Exported name uses lowercase because it's package-internal; keep testable via the same package.
func processStoreCreditJob(ctx context.Context, sqlDB *sql.DB, jobID, shop string) error {
	redisURL := os.Getenv("REDIS_URL")
	rdb := newRedisClient(redisURL)
	defer rdb.Close()

	progressKey := fmt.Sprintf("store_credit_job_status:%s", jobID)

	claimed, err := db.ClaimStoreCreditJob(ctx, sqlDB, jobID)
	if err != nil {
		if errors.Is(err, db.ErrStoreCreditJobNotClaimable) {
			return nil
		}
		return fmt.Errorf("claim: %w", err)
	}

	customerIDs := splitNonEmpty(claimed.CustomerIDs, ",")
	if err := db.InsertStoreCreditRecipients(ctx, sqlDB, jobID, customerIDs); err != nil {
		markStoreCreditJobFailed(ctx, sqlDB, jobID, fmt.Sprintf("insert recipients: %v", err))
		return err
	}

	writeProgress(ctx, rdb, progressKey, 0, claimed.Count, "running")

	accessToken, err := resolveAccessToken(ctx, sqlDB, shop)
	if err != nil {
		markStoreCreditJobFailed(ctx, sqlDB, jobID, fmt.Sprintf("auth: %v", err))
		return err
	}

	expiresAt := ""
	if claimed.ExpiresAt.Valid {
		expiresAt = claimed.ExpiresAt.Time.UTC().Format(time.RFC3339)
	}

	doneCount := 0
	failedCount := 0
	for _, numericID := range customerIDs {
		gid := "gid://shopify/Customer/" + numericID
		var (
			res    *shopify.StoreCreditResult
			ueErrs []shopify.StoreCreditUserError
			callErr error
		)
		for attempt := 0; attempt < storeCreditMaxRetries; attempt++ {
			res, ueErrs, callErr = shopify.IssueStoreCredit(
				ctx, shop, accessToken, gid,
				claimed.Amount, claimed.Currency, expiresAt, claimed.Notify,
			)
			if callErr == nil || !isTransientStoreCreditError(callErr) {
				break
			}
			time.Sleep(storeCreditRetryBaseBackoff * (1 << attempt))
		}

		if callErr != nil {
			failedCount++
			_ = db.MarkStoreCreditRecipientFailed(ctx, sqlDB, jobID, numericID, callErr.Error())
		} else if len(ueErrs) > 0 {
			failedCount++
			msg := ueErrs[0].Message
			_ = db.MarkStoreCreditRecipientFailed(ctx, sqlDB, jobID, numericID, msg)
		} else if res != nil {
			doneCount++
			_ = db.MarkStoreCreditRecipientSucceeded(ctx, sqlDB, jobID, numericID, res.AccountID, res.TransactionID)
		}

		writeProgress(ctx, rdb, progressKey, doneCount+failedCount, claimed.Count, "running")
	}

	if err := db.FinalizeStoreCreditJob(ctx, sqlDB, jobID); err != nil {
		return fmt.Errorf("finalize: %w", err)
	}

	finalStatus := deriveFinalStoreCreditStatus(claimed.Count, doneCount, failedCount)
	writeProgress(ctx, rdb, progressKey, doneCount+failedCount, claimed.Count, finalStatus)
	return nil
}

func isTransientStoreCreditError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "shopify 5xx") ||
		strings.Contains(msg, "rate limited") ||
		strings.Contains(msg, "http:")
}

func splitNonEmpty(s, sep string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, sep)
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func newRedisClient(url string) *redis.Client {
	opt, err := redis.ParseURL(url)
	if err != nil {
		log.Printf("redis parse url: %v — falling back to default", err)
		return redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	}
	return redis.NewClient(opt)
}

func writeProgress(ctx context.Context, rdb *redis.Client, key string, done, total int, status string) {
	if rdb == nil {
		return
	}
	_ = rdb.HSet(ctx, key,
		"done", done,
		"total", total,
		"status", status,
	).Err()
	_ = rdb.Expire(ctx, key, 24*time.Hour).Err()
}

func markStoreCreditJobFailed(ctx context.Context, sqlDB *sql.DB, jobID, msg string) {
	_, _ = sqlDB.ExecContext(ctx, `
		UPDATE store_credit_job SET status='failed', error_message=$1, finished_at=NOW()
		WHERE id=$2
	`, msg, jobID)
}

// resolveAccessToken fetches the offline access token from the Session table.
// The Shopify React Router adapter stores sessions in the same Prisma-managed table.
func resolveAccessToken(ctx context.Context, sqlDB *sql.DB, shop string) (string, error) {
	var token string
	if err := sqlDB.QueryRowContext(ctx, `
		SELECT "accessToken" FROM "Session"
		WHERE shop = $1 AND "isOnline" = false
		ORDER BY expires DESC NULLS LAST
		LIMIT 1
	`, shop).Scan(&token); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", fmt.Errorf("no offline session for %s", shop)
		}
		return "", err
	}
	if token == "" {
		return "", errors.New("empty access token")
	}
	return token, nil
}

// Prevent unused import removal during tooling refactors.
var _ = json.Marshal
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd services/worker && go test ./internal/handler/ -run StoreCredit -v`
Expected: PASS

- [ ] **Step 6: Run full worker test suite to confirm no regressions**

Run: `cd services/worker && go test ./...`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add services/worker/internal/handler/store_credit_handler.go services/worker/internal/handler/store_credit_handler_test.go
git commit -m "feat(store-credit): add worker handler with per-recipient retry"
```

---

## Task 12: Register the worker route in `main.go`

**Files:**
- Modify: `services/worker/cmd/worker/main.go`

- [ ] **Step 1: Add the authenticated route registration**

In `services/worker/cmd/worker/main.go`, after the existing line:

```go
authenticatedRouter.HandleFunc("/run-job", handler.RunJobHandler)
```

add:

```go
authenticatedRouter.HandleFunc("/run-store-credit-job", handler.RunStoreCreditJobHandler)
```

- [ ] **Step 2: Build the worker**

Run: `cd services/worker && go build ./...`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add services/worker/cmd/worker/main.go
git commit -m "feat(store-credit): register /run-store-credit-job route"
```

---

## Task 13: Scheduler loop for scheduled store credit jobs

**Files:**
- Modify: `services/worker/internal/handler/scheduler.go`

- [ ] **Step 1: Read the existing scheduled-dispatch loop** in `scheduler.go` (around the `runScheduledDispatchLoop` and `dispatchDueScheduledJobs` functions). You'll add a parallel loop for store-credit jobs.

- [ ] **Step 2: Extend the scheduler**

In `services/worker/internal/handler/scheduler.go`, modify `StartBackgroundDispatchers` to add a third goroutine:

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("PANIC recovered in store credit dispatch loop: %v — restarting", r)
            time.Sleep(5 * time.Second)
            go StartStoreCreditScheduledDispatchLoop()
        }
    }()
    StartStoreCreditScheduledDispatchLoop()
}()
```

Append to the same file:

```go
// StartStoreCreditScheduledDispatchLoop polls for due scheduled store credit jobs
// and dispatches them in-process using the same handler logic as the HTTP path.
func StartStoreCreditScheduledDispatchLoop() {
	dispatchDueScheduledStoreCreditJobs()
	ticker := time.NewTicker(scheduledDispatchInterval)
	defer ticker.Stop()
	for range ticker.C {
		dispatchDueScheduledStoreCreditJobs()
	}
}

func dispatchDueScheduledStoreCreditJobs() {
	dbURL := NormalizeDatabaseURL(os.Getenv("DATABASE_URL"))
	sqlDB, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Printf("store credit scheduler: db open: %v", err)
		return
	}
	defer sqlDB.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	jobs, err := db.ListDueScheduledStoreCreditJobs(ctx, sqlDB, scheduledDispatchBatch)
	if err != nil {
		log.Printf("store credit scheduler: list due: %v", err)
		return
	}

	for _, j := range jobs {
		select {
		case jobSemaphore <- struct{}{}:
		default:
			log.Printf("store credit scheduler: semaphore full, will retry next tick")
			return
		}
		jobID, shop := j.ID, j.ShopName
		go func() {
			defer func() { <-jobSemaphore }()
			ownDB, err := sql.Open("postgres", dbURL)
			if err != nil {
				log.Printf("store credit scheduler: db open for job %s: %v", jobID, err)
				return
			}
			defer ownDB.Close()
			if err := processStoreCreditJob(context.Background(), ownDB, jobID, shop); err != nil {
				log.Printf("store credit scheduler: job %s failed: %v", jobID, err)
			}
		}()
	}
}
```

- [ ] **Step 3: Build the worker**

Run: `cd services/worker && go build ./...`
Expected: exits 0.

- [ ] **Step 4: Run worker tests**

Run: `cd services/worker && go test ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/worker/internal/handler/scheduler.go
git commit -m "feat(store-credit): add scheduled dispatcher loop"
```

---

## Task 14: Nav link in `app.tsx`

**Files:**
- Modify: `app/routes/app.tsx`

- [ ] **Step 1: Read `app/routes/app.tsx` around lines 85-92** to see the current `s-link` nav block.

- [ ] **Step 2: Add the Store Credits entry**

In `app/routes/app.tsx`, between the `Home` link and the `Subscriptions` link, add:

```tsx
<s-link href="/app/store-credit">Store Credits</s-link>
```

Final order: Home · Store Credits · Subscriptions · Help · Changelog · Settings.

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint:app`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add app/routes/app.tsx
git commit -m "feat(store-credit): add Store Credits nav link"
```

---

## Task 15: Store Credits index / history page

**Files:**
- Create: `app/routes/app.store-credit.tsx`

- [ ] **Step 1: Write the route**

```tsx
import { Link, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { listStoreCreditJobsForShop } from "../lib/services/store-credit.server";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const jobs = await listStoreCreditJobsForShop(session.shop);
  return {
    jobs: jobs.map((j) => ({
      id: j.id,
      createdAt: j.createdAt.toISOString(),
      amount: j.amount.toString(),
      currency: j.currency,
      count: j.count,
      done: j.done,
      failed: j.failed,
      status: j.status,
      scheduledTimestamp: j.scheduledTimestamp,
    })),
  };
};

export default function StoreCreditIndex() {
  const { jobs } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Store Credits">
      <s-button slot="primary-action" href="/app/store-credit/create">
        Issue store credit
      </s-button>

      <s-section>
        {jobs.length === 0 ? (
          <s-banner tone="info">
            No store credit jobs yet. Issue your first batch to get started.
          </s-banner>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Job</s-table-header>
              <s-table-header>Created</s-table-header>
              <s-table-header>Amount × Recipients</s-table-header>
              <s-table-header>Currency</s-table-header>
              <s-table-header>Scheduled</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Done / Failed / Total</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {jobs.map((j) => (
                <s-table-row key={j.id}>
                  <s-table-cell>
                    <Link to={`/app/store-credit/${j.id}`}>{j.id.slice(0, 8)}</Link>
                  </s-table-cell>
                  <s-table-cell>
                    {new Date(j.createdAt).toLocaleString()}
                  </s-table-cell>
                  <s-table-cell>
                    {j.amount} × {j.count}
                  </s-table-cell>
                  <s-table-cell>{j.currency}</s-table-cell>
                  <s-table-cell>{j.scheduledTimestamp || "—"}</s-table-cell>
                  <s-table-cell>{j.status}</s-table-cell>
                  <s-table-cell>
                    {j.done} / {j.failed} / {j.count}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint:app`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add app/routes/app.store-credit.tsx
git commit -m "feat(store-credit): add Store Credits index page with history list"
```

---

## Task 16: Store Credits create form

**Files:**
- Create: `app/routes/app.store-credit.create.tsx`

- [ ] **Step 1: Read `app/routes/app.job.create.tsx` and `app/components/create-job-sections.tsx`** to see how the existing customer picker and scheduling section are composed. Reuse the customer-picker component reference and the scheduling block shape.

- [ ] **Step 2: Write the route**

```tsx
import { useState } from "react";
import { useNavigate, useOutletContext } from "react-router";
import { authenticate } from "../shopify.server";
import {
  STORE_CREDIT_SUPPORTED_CURRENCIES,
  type CreateStoreCreditJobBody,
} from "../../shared/store-credit";
import type { AppOutletContext } from "../lib/types/app";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { shopName: session.shop };
};

export default function CreateStoreCreditJob() {
  const { shopCurrency } = useOutletContext<AppOutletContext>();
  const navigate = useNavigate();

  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(
    (shopCurrency && STORE_CREDIT_SUPPORTED_CURRENCIES.includes(shopCurrency as never))
      ? shopCurrency
      : "EUR",
  );
  const [customerIds, setCustomerIds] = useState<string[]>([]);
  const [expireDate, setExpireDate] = useState<string>("");
  const [notify, setNotify] = useState(true);
  const [note, setNote] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [scheduledTimezone, setScheduledTimezone] = useState("");
  const [scheduledMessage, setScheduledMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setSubmitting(true);
    try {
      const body: CreateStoreCreditJobBody = {
        amount,
        currency: currency as CreateStoreCreditJobBody["currency"],
        customerIds,
        note: note || undefined,
        expireDate: expireDate || undefined,
        notify,
        scheduledDate: scheduledDate || undefined,
        scheduledTime: scheduledTime || undefined,
        scheduledTimezone: scheduledTimezone || undefined,
        scheduledMessage: scheduledMessage || undefined,
      };
      const res = await fetch("/api/store-credits/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.message || "Failed to create store credit job");
        return;
      }
      navigate(`/app/store-credit/${data.jobId}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <s-page heading="Issue store credit" back-link="/app/store-credit">
      <s-section>
        <form onSubmit={handleSubmit}>
          {errorMessage && <s-banner tone="critical">{errorMessage}</s-banner>}

          <s-text-field
            label="Customer IDs (comma-separated Shopify customer GIDs or numeric IDs)"
            value={customerIds.join(",")}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setCustomerIds(
                e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
            multiline={4}
            required
          />

          <s-text-field
            label="Amount per recipient"
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)}
            required
          />

          <s-select
            label="Currency"
            value={currency}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setCurrency(e.target.value)}
          >
            {STORE_CREDIT_SUPPORTED_CURRENCIES.map((c) => (
              <s-option key={c} value={c}>
                {c}
              </s-option>
            ))}
          </s-select>

          <s-text-field
            label="Expiration date (optional)"
            type="date"
            value={expireDate}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExpireDate(e.target.value)}
          />

          <s-checkbox
            checked={notify}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNotify(e.target.checked)}
          >
            Notify customer by email
          </s-checkbox>

          <s-text-field
            label="Note (internal, not sent to Shopify)"
            value={note}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNote(e.target.value)}
            multiline={3}
            maxLength={500}
          />

          <s-heading>Scheduled send (optional)</s-heading>
          <s-text-field
            label="Date"
            type="date"
            value={scheduledDate}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setScheduledDate(e.target.value)}
          />
          <s-text-field
            label="Time (HH:MM, 24h)"
            value={scheduledTime}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setScheduledTime(e.target.value)}
          />
          <s-text-field
            label="Timezone (IANA name, e.g. Europe/Berlin)"
            value={scheduledTimezone}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setScheduledTimezone(e.target.value)}
          />
          <s-text-field
            label="Message (optional)"
            value={scheduledMessage}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setScheduledMessage(e.target.value)}
            multiline={2}
          />

          <s-button type="submit" variant="primary" disabled={submitting}>
            {submitting ? "Issuing…" : "Issue store credit"}
          </s-button>
        </form>
      </s-section>
    </s-page>
  );
}
```

**Note:** This is a minimal form using plain `<s-text-field>` inputs for the customer list. A follow-up can swap in the same resource-picker the gift-card form uses (read `app/components/create-job-sections.tsx` to find it). For the MVP, a comma-separated textarea is acceptable and keeps the surface small.

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint:app`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add app/routes/app.store-credit.create.tsx
git commit -m "feat(store-credit): add Store Credits create form"
```

---

## Task 17: Store Credits job detail page

**Files:**
- Create: `app/routes/app.store-credit.$jobId.tsx`

- [ ] **Step 1: Write the route**

```tsx
import { useEffect, useState } from "react";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { getStoreCreditJobWithRecipients } from "../lib/services/store-credit.server";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const jobId = params.jobId!;
  const job = await getStoreCreditJobWithRecipients(session.shop, jobId);
  if (!job) {
    throw new Response("Job not found", { status: 404 });
  }
  return {
    job: {
      id: job.id,
      status: job.status,
      amount: job.amount.toString(),
      currency: job.currency,
      count: job.count,
      done: job.done,
      failed: job.failed,
      createdAt: job.createdAt.toISOString(),
      finishedAt: job.finishedAt?.toISOString() ?? null,
      scheduledTimestamp: job.scheduledTimestamp,
      recipients: job.recipients.map((r) => ({
        id: r.id,
        customerId: r.customerId,
        status: r.status,
        errorMessage: r.errorMessage,
        accountId: r.accountId,
        transactionId: r.transactionId,
        processedAt: r.processedAt?.toISOString() ?? null,
      })),
    },
  };
};

interface ProgressEntry {
  jobId: string;
  done: number;
  total: number;
  status: string;
}

export default function StoreCreditJobDetail() {
  const { job } = useLoaderData<typeof loader>();
  const [progress, setProgress] = useState<ProgressEntry | null>(null);

  useEffect(() => {
    if (job.status !== "running" && job.status !== "pending") return;

    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`/api/store-credits/progress?ids=${job.id}`);
        if (!res.ok) return;
        const data = (await res.json()) as ProgressEntry[];
        if (!cancelled && data[0]) setProgress(data[0]);
      } catch {
        /* ignore transient errors */
      }
    }
    poll();
    const iv = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [job.id, job.status]);

  const liveDone = progress?.done ?? job.done + job.failed;
  const liveStatus = progress?.status ?? job.status;

  return (
    <s-page heading={`Store credit job ${job.id.slice(0, 8)}`} back-link="/app/store-credit">
      <s-section>
        <s-stack>
          <s-paragraph>
            <strong>Status:</strong> {liveStatus}
          </s-paragraph>
          <s-paragraph>
            <strong>Progress:</strong> {liveDone} / {job.count}
          </s-paragraph>
          <s-paragraph>
            <strong>Amount:</strong> {job.amount} {job.currency} × {job.count}
          </s-paragraph>
          <s-paragraph>
            <strong>Created:</strong> {new Date(job.createdAt).toLocaleString()}
          </s-paragraph>
          {job.finishedAt && (
            <s-paragraph>
              <strong>Finished:</strong> {new Date(job.finishedAt).toLocaleString()}
            </s-paragraph>
          )}
          {job.scheduledTimestamp && (
            <s-paragraph>
              <strong>Scheduled for:</strong> {job.scheduledTimestamp}
            </s-paragraph>
          )}
        </s-stack>
      </s-section>

      <s-section>
        <s-heading>Recipients</s-heading>
        <s-table>
          <s-table-header-row>
            <s-table-header>Customer ID</s-table-header>
            <s-table-header>Status</s-table-header>
            <s-table-header>Error</s-table-header>
            <s-table-header>Processed</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {job.recipients.map((r) => (
              <s-table-row key={r.id}>
                <s-table-cell>{r.customerId}</s-table-cell>
                <s-table-cell>{r.status}</s-table-cell>
                <s-table-cell>{r.errorMessage || "—"}</s-table-cell>
                <s-table-cell>
                  {r.processedAt ? new Date(r.processedAt).toLocaleString() : "—"}
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
    </s-page>
  );
}
```

**Note:** Spec says the recipient table should resolve customer emails via `nodes(ids: [])`. That's a second-pass enrichment; the MVP renders `customerId` directly so the page works without an additional Admin API call. A follow-up task is filed in "Deferred UI polish" below.

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint:app`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add app/routes/app.store-credit.$jobId.tsx
git commit -m "feat(store-credit): add Store Credits job detail page with live progress"
```

---

## Task 18: Dashboard card

**Files:**
- Modify: `app/routes/app._index.tsx`

- [ ] **Step 1: Read `app/routes/app._index.tsx`** to understand its current section structure.

- [ ] **Step 2: Add a "Recent Store Credit jobs" card**

In the loader, add a query for the most recent 5 store credit jobs:

```tsx
import { listStoreCreditJobsForShop } from "../lib/services/store-credit.server";

// inside the existing loader, after the existing queries:
const recentStoreCreditJobs = (await listStoreCreditJobsForShop(session.shop, 5)).map((j) => ({
  id: j.id,
  createdAt: j.createdAt.toISOString(),
  amount: j.amount.toString(),
  currency: j.currency,
  count: j.count,
  status: j.status,
}));
```

Include `recentStoreCreditJobs` in the loader return. In the component, add a section alongside existing dashboard content:

```tsx
<s-section>
  <s-heading>Recent store credit jobs</s-heading>
  {recentStoreCreditJobs.length === 0 ? (
    <s-paragraph>No store credit jobs yet.</s-paragraph>
  ) : (
    <s-stack>
      {recentStoreCreditJobs.map((j) => (
        <s-paragraph key={j.id}>
          <Link to={`/app/store-credit/${j.id}`}>
            {j.id.slice(0, 8)}
          </Link>
          {" — "}
          {j.amount} {j.currency} × {j.count} ({j.status})
        </s-paragraph>
      ))}
    </s-stack>
  )}
  <s-button href="/app/store-credit">View all store credit jobs</s-button>
</s-section>
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint:app`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add app/routes/app._index.tsx
git commit -m "feat(store-credit): add Recent store credit jobs card to dashboard"
```

---

## Task 19: Full-stack verification

No code changes. This task verifies the whole feature works end-to-end.

- [ ] **Step 1: Full local verify**

Run: `npm run verify`
Expected: lint + typecheck + `go test ./...` all pass.

- [ ] **Step 2: Start local dev (Redis + worker + Shopify app)**

Run: `npm run dev`
Expected: `dev.sh` starts Redis, builds the worker, starts `shopify app dev`. Wait for the tunnel URL.

- [ ] **Step 3: Open the embedded app in a real Chrome session (per AGENTS.md)**

```bash
open -na "Google Chrome" --args \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-shopify-dev \
  "https://admin.shopify.com/store/app-store-apps-furkan/apps/datora-bulk-gift-cards-dev/app"
```

Complete Shopify login + re-authorize the app so the new scopes (`read_store_credit_accounts`, `write_store_credit_account_transactions`, `read_store_credit_account_transactions`) are granted.

- [ ] **Step 4: Verify the Store Credits nav entry is visible.** Click it — history list should render with "No store credit jobs yet."

- [ ] **Step 5: Issue a small credit to a single dev-store customer.**

Click "Issue store credit". Get one customer's numeric ID from Shopify admin (URL `/admin/customers/NNNNN`). Fill:
- Customer IDs: `NNNNN`
- Amount: `1.00`
- Currency: `EUR` (or shop default)
- Notify: leave checked

Submit. You should land on the job detail page with status `pending` → `running` → `completed` within a few seconds.

- [ ] **Step 6: Verify in Shopify admin**

Open the same customer in Shopify admin → Store credit section. Confirm a 1.00 balance appears and the notification email was received (if notify was checked and the customer has an email).

- [ ] **Step 7: Issue an intentionally failing job**

Submit another job with an invalid customer ID (e.g. `9999999999`). Expect `completed_with_errors` or `failed`, and the recipient row should show an error message.

- [ ] **Step 8: Verify scheduled send**

Submit a third job with a scheduled date/time 2 minutes in the future. Expect status `scheduled`, then auto-dispatch around the target time (worker polls every 30s).

- [ ] **Step 9: Commit nothing (verification only)**

This task produces no commits. If you find bugs, fix them in new commits referencing the affected task, then re-run verification.

---

## Deferred UI polish (not MVP — file tickets)

These items are deliberately not in this plan per the spec's "Out of scope" list, but noting them explicitly so they aren't forgotten:

- Resolve customer emails on the job detail page via `nodes(ids: [])` batched Admin query.
- Swap the plain customer-ID textarea for the resource-picker component used by the gift-card flow.
- Preflight banner for classic customer accounts (query `Shop.customerAccountsV2` in the create-form loader and render a Polaris banner if it's off).
- Ledger/balance view (`storeCreditAccount.transactions` connection).
- Debit / reverse flow (`storeCreditAccountDebit`).
- B2B `CompanyLocation` recipients.
- Per-recipient variable amounts (CSV upload).
- Recurring credits / birthday credits.

---

## Plan self-review checklist

1. **Spec coverage:** Every spec section is covered:
   - Data model → Task 1
   - Scopes → Task 2
   - Shared types/validation → Task 3
   - Web service (create, progress, history) → Tasks 4, 5
   - Worker trigger → Task 6
   - API routes (create, progress) → Tasks 7, 8
   - Worker DB helpers → Task 9
   - Shopify mutation wrapper → Task 10
   - Worker handler + retry → Task 11
   - `/run-store-credit-job` route wiring → Task 12
   - Scheduler loop → Task 13
   - Nav → Task 14
   - UI (index, create, detail) → Tasks 15, 16, 17
   - Dashboard card → Task 18
   - Manual e2e verification → Task 19
   - Preflight banner and resource picker: **explicitly deferred** (see "Deferred UI polish") — acceptable deviation because they are small polish items whose absence does not block the MVP's core value.

2. **Placeholder scan:** No TBD/TODO, no "add error handling", every code step has complete code. Customer-picker is swapped for a textarea with a labeled deferral instead of a vague "reuse the picker" placeholder.

3. **Type consistency:** `StoreCreditJobStatus` values, Redis key `store_credit_job_status:{jobId}`, endpoint path `/run-store-credit-job`, function name `triggerStoreCreditJob`, `StoreCreditResult{AccountID, TransactionID}`, `StoreCreditUserError{Field, Message}` — all consistent across Go + TS.

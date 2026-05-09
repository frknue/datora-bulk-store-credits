-- CreateTable
CREATE TABLE "store_credit_job" (
    "id" TEXT NOT NULL,
    "shop_name" TEXT NOT NULL,
    "user_id" BIGINT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "notify" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "customer_ids" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "done" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "scheduled_date" TEXT,
    "scheduled_time" TEXT,
    "scheduled_timezone" TEXT,
    "scheduled_timestamp" TEXT,
    "scheduled_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "store_credit_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_credit_job_recipient" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "account_id" TEXT,
    "transaction_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error_message" TEXT,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "store_credit_job_recipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_credit_job_shop_name_status_idx" ON "store_credit_job"("shop_name", "status");

-- CreateIndex
CREATE INDEX "store_credit_job_created_at_idx" ON "store_credit_job"("created_at");

-- CreateIndex
CREATE INDEX "store_credit_job_recipient_job_id_idx" ON "store_credit_job_recipient"("job_id");

-- CreateIndex
CREATE INDEX "store_credit_job_recipient_customer_id_idx" ON "store_credit_job_recipient"("customer_id");

-- AddForeignKey
ALTER TABLE "store_credit_job_recipient" ADD CONSTRAINT "store_credit_job_recipient_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "store_credit_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

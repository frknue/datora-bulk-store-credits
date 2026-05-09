-- CreateTable
CREATE TABLE "User" (
    "shop_name" TEXT NOT NULL,
    "show_card" BOOLEAN NOT NULL DEFAULT true,
    "completed_onboarding" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "User_pkey" PRIMARY KEY ("shop_name")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "done" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "value" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "shop_name" TEXT NOT NULL DEFAULT '',
    "user_id" BIGINT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "prefix" VARCHAR(4),
    "postfix" VARCHAR(4),
    "code_length" INTEGER DEFAULT 16,
    "presetId" TEXT,
    "expire_date" TEXT,
    "subscription_plan_id" INTEGER,
    "customer_ids" TEXT,
    "scheduled_time" TEXT,
    "scheduled_date" TEXT,
    "scheduledTimezone" TEXT,
    "scheduled_timestamp" TEXT,
    "scheduled_message" TEXT,
    "error_message" TEXT,
    "gift_card_currency" TEXT,
    "gift_cards" JSONB[] DEFAULT ARRAY[]::JSONB[],
    "usage_last_refreshed_at" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Preset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "count" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "value" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "shop_name" TEXT NOT NULL DEFAULT '',
    "prefix" VARCHAR(4),
    "postfix" VARCHAR(4),
    "code_length" INTEGER DEFAULT 16,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gift_card_currency" TEXT,

    CONSTRAINT "Preset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_card_usage" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "gift_card_id" TEXT NOT NULL,
    "last_characters" TEXT NOT NULL,
    "initial_value" DECIMAL(10,2) NOT NULL,
    "current_balance" DECIMAL(10,2) NOT NULL,
    "amount_redeemed" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL,
    "balance_status" TEXT NOT NULL,
    "last_checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_card_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gift_card_usage_job_id_idx" ON "gift_card_usage"("job_id");

-- CreateIndex
CREATE INDEX "gift_card_usage_gift_card_id_idx" ON "gift_card_usage"("gift_card_id");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "Preset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_card_usage" ADD CONSTRAINT "gift_card_usage_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

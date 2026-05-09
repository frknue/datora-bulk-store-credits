-- CreateIndex
CREATE INDEX "store_credit_job_status_scheduled_timestamp_idx" ON "store_credit_job"("status", "scheduled_timestamp");

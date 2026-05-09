-- CreateIndex
CREATE INDEX "Job_shop_name_status_idx" ON "Job"("shop_name", "status");

-- CreateIndex
CREATE INDEX "Job_created_at_idx" ON "Job"("created_at");

-- AddCheckConstraint: restrict status to known values
ALTER TABLE "Job" ADD CONSTRAINT "Job_status_check"
  CHECK (status IN ('scheduled', 'pending', 'running', 'completed', 'failed', 'cancelled'));

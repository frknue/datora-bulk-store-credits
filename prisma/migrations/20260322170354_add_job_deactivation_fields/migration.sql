-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "deactivated_at" TIMESTAMP(3),
ADD COLUMN     "job_type" TEXT NOT NULL DEFAULT 'create',
ADD COLUMN     "source_job_id" TEXT;

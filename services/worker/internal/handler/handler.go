package handler

import (
	"context"
	"crypto/tls"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/Datora-Websystems/datora-bulk-gift-cards/services/worker/internal/db"
	"github.com/Datora-Websystems/datora-bulk-gift-cards/services/worker/internal/models"
	"github.com/Datora-Websystems/datora-bulk-gift-cards/services/worker/internal/shopify"
	"github.com/Datora-Websystems/datora-bulk-gift-cards/services/worker/internal/slack"
	"github.com/go-redis/redis/v8"
	_ "github.com/lib/pq" // PostgreSQL driver
)

// maxConcurrentJobs limits how many jobs can run in parallel to prevent memory exhaustion.
var jobSemaphore = make(chan struct{}, 10)

type jobStatusCache interface {
	HSet(ctx context.Context, key string, values ...interface{}) *redis.IntCmd
	Expire(ctx context.Context, key string, expiration time.Duration) *redis.BoolCmd
}

// RunJobHandler atomically claims a job and starts async processing.
// The endpoint is idempotent: calling it for an already-running or completed job returns 200.
func RunJobHandler(w http.ResponseWriter, r *http.Request) {
	// Read required env variables.
	presharedKey := os.Getenv("PRESHARED_AUTH_HEADER_KEY")
	if presharedKey == "" {
		presharedKey = "x-api-key"
	}
	presharedValue := os.Getenv("PRESHARED_AUTH_HEADER_VALUE")
	serviceUrl := os.Getenv("SERVICE_URL")
	dbURL := os.Getenv("DATABASE_URL")
	redisURL := os.Getenv("REDIS_URL")
	dbURL = NormalizeDatabaseURL(dbURL)

	// Validate critical environment variables.
	if dbURL == "" || redisURL == "" || serviceUrl == "" || presharedValue == "" {
		http.Error(w, "One or more required environment variables are missing", http.StatusInternalServerError)
		return
	}

	// Parse query parameters: job ID and shop name.
	jobID := r.URL.Query().Get("id")
	if jobID == "" {
		http.Error(w, "Job ID is missing", http.StatusBadRequest)
		return
	}
	shopName := r.URL.Query().Get("shop")
	if shopName == "" {
		http.Error(w, "Shop name is missing", http.StatusBadRequest)
		return
	}

	// Connect to PostgreSQL for the claim.
	sqlDB, err := sql.Open("postgres", dbURL)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error opening database: %v", err), http.StatusInternalServerError)
		return
	}
	defer sqlDB.Close()

	// Check current status for idempotency before attempting claim.
	job, err := db.FetchJob(r.Context(), sqlDB, jobID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error fetching job: %v", err), http.StatusInternalServerError)
		return
	}

	switch job.Status {
	case string(db.JobStatusRunning), string(db.JobStatusCompleted), string(db.JobStatusCancelled):
		// Idempotent: job is already past pending, nothing to do.
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(fmt.Sprintf(`{"message": "Job already %s"}`, job.Status)))
		return
	case string(db.JobStatusScheduled):
		http.Error(w, "Job is scheduled and cannot be triggered directly", http.StatusConflict)
		return
	}

	// Atomically claim the job (pending -> running) with shop-level serialization.
	err = db.ClaimJob(r.Context(), sqlDB, jobID)
	if err != nil {
		if errors.Is(err, db.ErrJobNotPending) {
			// Another trigger claimed it between our check and the claim — still OK.
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"message": "Job already claimed"}`))
			return
		}
		if errors.Is(err, db.ErrShopHasRunningJob) {
			// Shop already has a running job; this one stays pending for later dispatch.
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"message": "Job queued, shop has a running job"}`))
			return
		}
		http.Error(w, fmt.Sprintf("Error claiming job: %v", err), http.StatusInternalServerError)
		return
	}

	// Claim succeeded — return 200 and process asynchronously.
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"message": "Job accepted and will be processed"}`))

	go func() {
		jobSemaphore <- struct{}{}        // acquire slot
		defer func() { <-jobSemaphore }() // release slot
		processJobAsync(jobID, shopName, dbURL, redisURL, serviceUrl, presharedKey, presharedValue)
	}()
}

// processJobAsync handles gift card creation for a job that has already been
// claimed (status = running). Every exit path must set a terminal status.
//
// No job-level timeout is applied. Large jobs (e.g. 75k cards) can legitimately
// run for many hours. Individual HTTP requests have their own timeouts (30s via
// shopifyClient), and the retry logic handles transient failures. Stale job
// reconciliation on worker restart catches truly stuck jobs.
func processJobAsync(jobID, shopName, dbURL, redisURL, serviceUrl, presharedKey, presharedValue string) {
	dbURL = NormalizeDatabaseURL(dbURL)

	// Always try to dispatch the next pending job for this shop on the way
	// out — completed, cancelled, failed, or any error path. Uses its own
	// short-lived connection so it doesn't depend on the body's sqlDB
	// (which may fail to open or be closed by the time this runs). Registered
	// first so it runs LAST in the defer LIFO — after the recover and cleanup
	// defers below have finalized the job's terminal status.
	defer func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("PANIC recovered in dispatch defer for job %s: %v", jobID, r)
			}
		}()
		dispatchCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		dispatchDB, err := sql.Open("postgres", dbURL)
		if err != nil {
			log.Printf("Cannot dispatch next pending job after %s (DB open failed): %v", jobID, err)
			return
		}
		defer dispatchDB.Close()
		dispatchNextPendingJob(dispatchCtx, dispatchDB, shopName, serviceUrl, presharedKey, presharedValue)
	}()

	// Recover from panics so a single bad job doesn't crash the worker process.
	defer func() {
		if r := recover(); r != nil {
			log.Printf("PANIC recovered in job %s: %v", jobID, r)
			if sqlDB, err := sql.Open("postgres", dbURL); err == nil {
				defer sqlDB.Close()
				_ = db.ChangeJobStatus(context.Background(), sqlDB, jobID, string(db.JobStatusFailed))
				errMsg := fmt.Sprintf("Internal error (panic): %v", r)
				_ = db.SaveErrorMessage(context.Background(), sqlDB, jobID, &errMsg)
			}
		}
	}()

	ctx := context.Background()

	// Connect to PostgreSQL.
	sqlDB, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Printf("Error opening database in async job %s: %v", jobID, err)
		// Best-effort: try a separate connection to mark the job failed.
		failJobBestEffort(dbURL, jobID, fmt.Sprintf("Worker internal error: %v", err))
		return
	}
	defer sqlDB.Close()

	// Connect to Redis.
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Printf("Error parsing Redis URL in async job %s: %v", jobID, err)
		markJobFailed(ctx, sqlDB, jobID, fmt.Sprintf("Worker internal error: %v", err))
		return
	}
	if strings.HasPrefix(redisURL, "rediss") {
		opt.TLSConfig = &tls.Config{
			InsecureSkipVerify: os.Getenv("REDIS_TLS_INSECURE") == "true",
		}
	}
	redisClient := redis.NewClient(opt)
	defer redisClient.Close()

	// Safety net: if we exit without explicitly handling status, mark the job failed
	// in both DB and Redis. The job is already 'running' from ClaimJob.
	var jobStatusHandled bool
	defer func() {
		if !jobStatusHandled {
			_ = db.ChangeJobStatus(ctx, sqlDB, jobID, string(db.JobStatusFailed))
			errMsg := "Job failed due to an unhandled error"
			_ = db.SaveErrorMessage(ctx, sqlDB, jobID, &errMsg)
			redisKey := fmt.Sprintf("job_status:%s", jobID)
			redisClient.HSet(ctx, redisKey, "status", "failed")
			log.Printf("Cleaned up stuck job %s by setting status to failed", jobID)
		}
	}()

	// Re-fetch the job to check for cancellation that may have occurred after the claim.
	job, err := db.FetchJob(ctx, sqlDB, jobID)
	if err != nil {
		log.Printf("Error fetching job %s: %v", jobID, err)
		markJobFailed(ctx, sqlDB, jobID, fmt.Sprintf("Failed to fetch job: %v", err))
		jobStatusHandled = true
		return
	}

	if job.Status == string(db.JobStatusCancelled) {
		jobStatusHandled = true
		log.Printf("Skipping cancelled job %s", jobID)
		return
	}

	// Retrieve the Shopify auth token.
	token, err := db.GetShopifyAuthToken(ctx, sqlDB, shopName)
	if err != nil || token == "" {
		log.Printf("Shopify token is missing for job %s", jobID)
		markJobFailed(ctx, sqlDB, jobID, "Shopify access token not found for this shop")
		jobStatusHandled = true
		return
	}

	redisKey := fmt.Sprintf("job_status:%s", jobID)

	// Dispatch based on job type.
	if job.JobType == "deactivate" {
		log.Printf("Starting gift card deactivation for job %s", jobID)
		if job.SourceJobID == nil {
			markJobFailed(ctx, sqlDB, jobID, "Deactivation job missing source job ID")
			jobStatusHandled = true
			return
		}

		sourceJob, err := db.FetchJob(ctx, sqlDB, *job.SourceJobID)
		if err != nil {
			markJobFailed(ctx, sqlDB, jobID, fmt.Sprintf("Failed to fetch source job: %v", err))
			jobStatusHandled = true
			return
		}

		err = shopify.DeactivateGiftCards(ctx, sqlDB, redisClient, *job, *sourceJob, token)
		if err != nil {
			_ = db.ChangeJobStatus(ctx, sqlDB, jobID, string(db.JobStatusFailed))
			redisClient.HSet(ctx, redisKey, "status", "failed")
			jobStatusHandled = true
			sendSlackNotification(ctx, sqlDB, slack.JobResult{
				JobID: jobID, ShopName: shopName, JobType: "deactivate",
				Status: "failed", ErrorMsg: fmt.Sprintf("Deactivation error: %v", err),
			})
			log.Printf("Error deactivating gift cards for job %s: %v", jobID, err)
			return
		}

		// Mark deactivation job as completed.
		_ = db.ChangeJobStatus(ctx, sqlDB, jobID, string(db.JobStatusCompleted))
		redisClient.HSet(ctx, redisKey, map[string]interface{}{
			"status": "completed",
			"done":   len(sourceJob.GiftCards),
			"total":  len(sourceJob.GiftCards),
		})
		redisClient.Expire(ctx, redisKey, 24*time.Hour)
		jobStatusHandled = true

		// Mark the source job as deactivated.
		if err := db.MarkSourceJobDeactivated(ctx, sqlDB, *job.SourceJobID); err != nil {
			log.Printf("Warning: failed to mark source job %s as deactivated: %v", *job.SourceJobID, err)
		}

		sendSlackNotification(ctx, sqlDB, slack.JobResult{
			JobID: jobID, ShopName: shopName, JobType: "deactivate",
			Status: "completed", Count: len(sourceJob.GiftCards),
		})
		log.Printf("Deactivation job %s completed successfully", jobID)
	} else {
		log.Printf("Starting gift card creation for job %s", jobID)

		// Create gift cards.
		giftCards, err := shopify.CreateGiftCards(ctx, sqlDB, redisClient, *job, token)
		if err != nil {
			_ = db.ChangeJobStatus(ctx, sqlDB, jobID, string(db.JobStatusFailed))
			redisClient.HSet(ctx, redisKey, "status", "failed")
			jobStatusHandled = true
			sendSlackNotification(ctx, sqlDB, slack.JobResult{
				JobID: jobID, ShopName: shopName, JobType: "create",
				Status: "failed", ErrorMsg: fmt.Sprintf("Gift card creation error: %v", err),
			})
			log.Printf("Error creating gift cards for job %s: %v", jobID, err)
			return
		}

		finalStatus, err := finalizeCreateJobResult(ctx, sqlDB, redisClient, redisKey, *job, giftCards)
		if err != nil {
			_ = db.ChangeJobStatus(ctx, sqlDB, jobID, string(db.JobStatusFailed))
			redisClient.HSet(ctx, redisKey, "status", "failed")
			jobStatusHandled = true
			log.Printf("Error finalizing create job %s: %v", jobID, err)
			return
		}
		jobStatusHandled = true
		if finalStatus == string(db.JobStatusCancelled) {
			log.Printf("Job %s cancelled after creating %d/%d gift cards", jobID, len(giftCards), job.Count)
			return
		}
		if finalStatus == string(db.JobStatusFailed) {
			sendSlackNotification(ctx, sqlDB, slack.JobResult{
				JobID: jobID, ShopName: shopName, JobType: "create",
				Status: "failed", ErrorMsg: fmt.Sprintf("Created %d/%d cards", len(giftCards), job.Count),
			})
			log.Printf("Job %s created %d/%d cards, marking as failed", jobID, len(giftCards), job.Count)
			return
		}

		currency := ""
		if len(giftCards) > 0 {
			currency = giftCards[0].Currency
		}
		sendSlackNotification(ctx, sqlDB, slack.JobResult{
			JobID: jobID, ShopName: shopName, JobType: "create",
			Status: "completed", Count: job.Count, Value: job.Value, Currency: currency,
		})
		log.Printf("Job %s completed successfully", jobID)
	}
}

func finalizeCreateJobResult(
	ctx context.Context,
	sqlDB *sql.DB,
	redisClient jobStatusCache,
	redisKey string,
	job models.JobData,
	giftCards []models.GiftCard,
) (string, error) {
	currentStatus, err := db.GetJobStatus(ctx, sqlDB, job.ID)
	if err != nil {
		return "", fmt.Errorf("failed to get final job status: %w", err)
	}
	if currentStatus == string(db.JobStatusCancelled) {
		if err := db.SaveGiftCardsToDb(ctx, sqlDB, giftCards, job); err != nil {
			return "", fmt.Errorf("failed to save partial gift cards for cancelled job: %w", err)
		}
		if err := db.ChangeJobStatus(ctx, sqlDB, job.ID, string(db.JobStatusCancelled)); err != nil {
			return "", fmt.Errorf("failed to finalize cancelled job: %w", err)
		}
		redisClient.HSet(ctx, redisKey, map[string]interface{}{
			"status": "cancelled",
			"done":   len(giftCards),
			"total":  job.Count,
		})
		redisClient.Expire(ctx, redisKey, 24*time.Hour)
		return string(db.JobStatusCancelled), nil
	}

	// Atomically save gift cards and mark as completed in one DB transaction,
	// then update Redis only after the transaction commits.
	if len(giftCards) == job.Count {
		if err := db.CompleteJobWithGiftCards(ctx, sqlDB, giftCards, job); err != nil {
			return "", fmt.Errorf("failed to complete job: %w", err)
		}
		redisClient.HSet(ctx, redisKey, map[string]interface{}{
			"status": "completed",
			"done":   job.Count,
			"total":  job.Count,
		})
		redisClient.Expire(ctx, redisKey, 24*time.Hour)
		return string(db.JobStatusCompleted), nil
	}

	// Partial completion — save what we have but mark as failed.
	_ = db.SaveGiftCardsToDb(ctx, sqlDB, giftCards, job)
	_ = db.ChangeJobStatus(ctx, sqlDB, job.ID, string(db.JobStatusFailed))
	redisClient.HSet(ctx, redisKey, "status", "failed")
	return string(db.JobStatusFailed), nil
}

// markJobFailed sets a job to failed status and saves an error message.
func markJobFailed(ctx context.Context, sqlDB *sql.DB, jobID, errMsg string) {
	_ = db.ChangeJobStatus(ctx, sqlDB, jobID, string(db.JobStatusFailed))
	_ = db.SaveErrorMessage(ctx, sqlDB, jobID, &errMsg)
}

// failJobBestEffort opens a new DB connection to mark a job failed. Used when
// the primary connection could not be established.
func failJobBestEffort(dbURL, jobID, errMsg string) {
	sqlDB, err := sql.Open("postgres", NormalizeDatabaseURL(dbURL))
	if err != nil {
		log.Printf("Cannot mark job %s failed (DB unavailable): %v", jobID, err)
		return
	}
	defer sqlDB.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	markJobFailed(ctx, sqlDB, jobID, errMsg)
}

// sendSlackNotification fetches the shop's webhook URL and sends a notification
// in a fire-and-forget goroutine. It never blocks or fails the caller.
func sendSlackNotification(ctx context.Context, sqlDB *sql.DB, result slack.JobResult) {
	webhookURL, err := db.GetSlackWebhookURL(ctx, sqlDB, result.ShopName)
	if err != nil {
		log.Printf("Slack: error fetching webhook for %s: %v", result.ShopName, err)
		return
	}
	if webhookURL == "" {
		return
	}
	go slack.SendJobNotification(webhookURL, result)
}

// dispatchNextPendingJob triggers the next pending job for a shop after the
// current one finishes.
func dispatchNextPendingJob(ctx context.Context, sqlDB *sql.DB, shopName, serviceUrl, presharedKey, presharedValue string) {
	hasRunning, err := db.HasRunningJob(ctx, sqlDB, shopName)
	if err != nil {
		log.Printf("Error checking for running job: %v", err)
	}
	if hasRunning {
		log.Printf("Another job is still running for shop %s", shopName)
		return
	}

	log.Printf("Fetching oldest pending job for shop: %s", shopName)
	oldestPendingJob, err := db.GetOldestPendingJob(ctx, sqlDB, shopName)
	if err != nil {
		log.Printf("Error fetching oldest pending job: %v", err)
		return
	}
	if oldestPendingJob == nil {
		return
	}

	reqUrl := fmt.Sprintf("%s/run-job?id=%s&shop=%s", serviceUrl, oldestPendingJob.ID, oldestPendingJob.ShopName)
	log.Printf("Triggering next job: %s", reqUrl)

	triggerCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(triggerCtx, "GET", reqUrl, nil)
	if err != nil {
		log.Printf("Error creating request for next job: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(presharedKey, presharedValue)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("Error triggering next job: %v", err)
	} else {
		resp.Body.Close()
		log.Printf("Successfully triggered next job: %s", oldestPendingJob.ID)
	}
}

func NormalizeDatabaseURL(raw string) string {
	if raw == "" {
		return raw
	}

	parsed, err := url.Parse(raw)
	if err != nil {
		return raw
	}

	host := parsed.Hostname()
	if host != "localhost" && host != "127.0.0.1" {
		return raw
	}

	query := parsed.Query()
	if query.Get("sslmode") != "" {
		return raw
	}

	query.Set("sslmode", "disable")
	parsed.RawQuery = query.Encode()

	return parsed.String()
}

// HealthCheckHandler is a simple health check endpoint.
func HealthCheckHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"message": "Service is healthy"}`))
}

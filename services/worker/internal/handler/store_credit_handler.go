package handler

import (
	"context"
	"database/sql"
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

	// Idempotency: if job is already past pending/scheduled, return 200 without re-claim.
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

// processStoreCreditJob runs the full job lifecycle for an unclaimed job from the HTTP path.
func processStoreCreditJob(ctx context.Context, sqlDB *sql.DB, jobID, shop string) error {
	claimed, err := db.ClaimStoreCreditJob(ctx, sqlDB, jobID)
	if err != nil {
		if errors.Is(err, db.ErrStoreCreditJobNotClaimable) {
			return nil
		}
		return fmt.Errorf("claim: %w", err)
	}
	return processAlreadyClaimedStoreCreditJob(ctx, sqlDB, claimed, shop)
}

// processAlreadyClaimedStoreCreditJob runs the job lifecycle for a job that is already
// in 'running' state. Used by both the HTTP path (after claiming) and the scheduler
// (after atomic promote).
func processAlreadyClaimedStoreCreditJob(ctx context.Context, sqlDB *sql.DB, claimed *db.StoreCreditJob, shop string) error {
	redisURL := os.Getenv("REDIS_URL")
	rdb := newStoreCreditRedisClient(redisURL)
	if rdb != nil {
		defer rdb.Close()
	}

	jobID := claimed.ID
	progressKey := fmt.Sprintf("store_credit_job_status:%s", jobID)

	customerIDs := splitNonEmptyStoreCredit(claimed.CustomerIDs, ",")
	if err := db.InsertStoreCreditRecipients(ctx, sqlDB, jobID, customerIDs); err != nil {
		markStoreCreditJobFailed(ctx, sqlDB, jobID, fmt.Sprintf("insert recipients: %v", err))
		return err
	}

	writeStoreCreditProgress(ctx, rdb, progressKey, 0, claimed.Count, "running")

	accessToken, err := resolveShopAccessToken(ctx, sqlDB, shop)
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
			res     *shopify.StoreCreditResult
			ueErrs  []shopify.StoreCreditUserError
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

		writeStoreCreditProgress(ctx, rdb, progressKey, doneCount+failedCount, claimed.Count, "running")
	}

	if err := db.FinalizeStoreCreditJob(ctx, sqlDB, jobID); err != nil {
		return fmt.Errorf("finalize: %w", err)
	}

	finalStatus := deriveFinalStoreCreditStatus(claimed.Count, doneCount, failedCount)
	writeStoreCreditProgress(ctx, rdb, progressKey, doneCount+failedCount, claimed.Count, finalStatus)
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

func splitNonEmptyStoreCredit(s, sep string) []string {
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

func newStoreCreditRedisClient(url string) *redis.Client {
	if url == "" {
		return nil
	}
	opt, err := redis.ParseURL(url)
	if err != nil {
		log.Printf("store credit redis parse url: %v", err)
		return nil
	}
	return redis.NewClient(opt)
}

func writeStoreCreditProgress(ctx context.Context, rdb *redis.Client, key string, done, total int, status string) {
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

// resolveShopAccessToken fetches the offline access token from the Session table
// used by the React Router Shopify adapter. Called resolveShopAccessToken rather
// than resolveAccessToken to avoid collision with any future helper.
func resolveShopAccessToken(ctx context.Context, sqlDB *sql.DB, shop string) (string, error) {
	var token string
	if err := sqlDB.QueryRowContext(ctx, `
		SELECT "accessToken" FROM "Session"
		WHERE shop = $1 AND "isOnline" = false
		ORDER BY "expires" IS NULL DESC, "expires" DESC
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

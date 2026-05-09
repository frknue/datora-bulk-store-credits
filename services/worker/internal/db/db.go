package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/Datora-Websystems/datora-bulk-gift-cards/services/worker/internal/models"
	"github.com/Datora-Websystems/datora-bulk-gift-cards/services/worker/internal/utils"
	"github.com/lib/pq"
)

// Claim errors returned by ClaimJob.
var (
	ErrJobNotPending     = errors.New("job is not in pending status")
	ErrShopHasRunningJob = errors.New("shop already has a running job")
)

// JobStatus represents the job status.
type JobStatus string

const (
	JobStatusScheduled JobStatus = "scheduled"
	JobStatusPending   JobStatus = "pending"
	JobStatusRunning   JobStatus = "running"
	JobStatusCompleted JobStatus = "completed"
	JobStatusFailed    JobStatus = "failed"
	JobStatusCancelled JobStatus = "cancelled"
)

// ClaimJob atomically transitions a job from pending to running,
// ensuring no other job is already running for the same shop.
// Returns ErrJobNotPending if the job isn't pending, or
// ErrShopHasRunningJob if the shop already has a running job.
func ClaimJob(ctx context.Context, db *sql.DB, jobID string) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Lock the job row and read its current state.
	var status, shopName string
	err = tx.QueryRowContext(ctx,
		`SELECT status, shop_name FROM public."Job" WHERE id = $1 FOR UPDATE`,
		jobID,
	).Scan(&status, &shopName)
	if err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf("job with ID %s not found", jobID)
		}
		return fmt.Errorf("failed to lock job: %w", err)
	}

	if status != string(JobStatusPending) {
		return ErrJobNotPending
	}

	// Serialize concurrent ClaimJob calls for the same shop. Locking the
	// target row above is not enough: two concurrent claims for different
	// pending jobs in the same shop lock different rows, both observe
	// runningCount = 0, and both transition to running. The advisory lock
	// is released when the transaction commits or rolls back.
	if _, err = tx.ExecContext(ctx,
		`SELECT pg_advisory_xact_lock(hashtext($1))`,
		shopName,
	); err != nil {
		return fmt.Errorf("failed to acquire shop advisory lock: %w", err)
	}

	// Check shop-level serialization: only one running job per shop.
	var runningCount int
	err = tx.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM public."Job" WHERE shop_name = $1 AND status = 'running'`,
		shopName,
	).Scan(&runningCount)
	if err != nil {
		return fmt.Errorf("failed to check running jobs: %w", err)
	}
	if runningCount > 0 {
		return ErrShopHasRunningJob
	}

	// Claim the job.
	_, err = tx.ExecContext(ctx,
		`UPDATE public."Job" SET status = 'running' WHERE id = $1`,
		jobID,
	)
	if err != nil {
		return fmt.Errorf("failed to claim job: %w", err)
	}

	return tx.Commit()
}

// FetchJob retrieves a job record by its ID.
func FetchJob(ctx context.Context, db *sql.DB, jobID string) (*models.JobData, error) {
	if jobID == "" {
		return nil, errors.New("job ID is missing")
	}
	if db == nil {
		return nil, errors.New("database client is missing")
	}

	// Explicitly list the columns to ensure the correct order.
	query := `
        SELECT id, count, value, note, shop_name, user_id, status, created_at, finished_at,
               prefix, postfix, code_length, expire_date, subscription_plan_id,
               customer_ids, scheduled_timestamp, scheduled_message, gift_cards,
               job_type, source_job_id
        FROM public."Job"
        WHERE id = $1
    `
	row := db.QueryRowContext(ctx, query, jobID)

	var job models.JobData
	// Use sql.Null types to handle nullable columns.
	var note, prefix, postfix, expireDate, customerIDs, scheduledTimestamp, scheduledMessage sql.NullString
	var userID sql.NullInt64
	var finishedAt sql.NullTime
	var subscriptionPlanID sql.NullInt64
	var giftCardsArray pq.StringArray
	var jobType sql.NullString
	var sourceJobID sql.NullString

	err := row.Scan(
		&job.ID,
		&job.Count,
		&job.Value,
		&note,
		&job.ShopName,
		&userID,
		&job.Status,
		&job.CreatedAt,
		&finishedAt,
		&prefix,
		&postfix,
		&job.CodeLength,
		&expireDate,
		&subscriptionPlanID,
		&customerIDs,
		&scheduledTimestamp,
		&scheduledMessage,
		&giftCardsArray,
		&jobType,
		&sourceJobID,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("job with ID %s not found", jobID)
		}
		return nil, err
	}
	if note.Valid {
		job.Note = &note.String
	}
	if userID.Valid {
		job.UserID = fmt.Sprintf("%d", userID.Int64)
	}
	if finishedAt.Valid {
		job.FinishedAt = &finishedAt.Time
	}
	if prefix.Valid {
		job.Prefix = &prefix.String
	}
	if postfix.Valid {
		job.Postfix = &postfix.String
	}
	if expireDate.Valid {
		job.ExpireDate = &expireDate.String
	}
	if subscriptionPlanID.Valid {
		tmp := int(subscriptionPlanID.Int64)
		job.SubscriptionPlanID = &tmp
	}
	if customerIDs.Valid {
		job.CustomerIDs = &customerIDs.String
	}
	if scheduledTimestamp.Valid {
		job.ScheduledTimestamp = &scheduledTimestamp.String
	}
	if scheduledMessage.Valid {
		job.ScheduledMessage = &scheduledMessage.String
	}
	job.JobType = "create"
	if jobType.Valid && jobType.String != "" {
		job.JobType = jobType.String
	}
	if sourceJobID.Valid {
		job.SourceJobID = &sourceJobID.String
	}

	// Handle the gift_cards array:
	// Parse each element of the PostgreSQL array as a JSON object.
	// The DB stores fields in snake_case, so we use a matching struct.
	job.GiftCards = []models.GiftCard{}
	if giftCardsArray != nil && len(giftCardsArray) > 0 {
		for _, jsonStr := range giftCardsArray {
			var gc struct {
				ID             string  `json:"id"`
				Code           string  `json:"code"`
				LastCharacters string  `json:"last_characters"`
				Balance        string  `json:"balance"`
				Currency       string  `json:"currency"`
				Value          float64 `json:"value"`
				Status         string  `json:"status"`
				CreatedAt      string  `json:"created_at"`
			}
			if err := json.Unmarshal([]byte(jsonStr), &gc); err != nil {
				return nil, fmt.Errorf("failed to unmarshal gift card: %w", err)
			}
			idFloat := 0.0
			if gc.ID != "" {
				if _, err := fmt.Sscanf(gc.ID, "%f", &idFloat); err != nil {
					return nil, fmt.Errorf("failed to parse gift card ID: %w", err)
				}
			}
			var createdAt time.Time
			if gc.CreatedAt != "" {
				if parsed, parseErr := time.Parse(time.RFC3339, gc.CreatedAt); parseErr == nil {
					createdAt = parsed
				}
			}
			job.GiftCards = append(job.GiftCards, models.GiftCard{
				ID:             idFloat,
				Code:           gc.Code,
				LastCharacters: gc.LastCharacters,
				Balance:        gc.Balance,
				Currency:       gc.Currency,
				Value:          gc.Value,
				Status:         gc.Status,
				CreatedAt:      createdAt,
			})
		}
	}

	return &job, nil
}

// GetShopifyAuthToken retrieves the access token for a given shop.
func GetShopifyAuthToken(ctx context.Context, db *sql.DB, shop string) (string, error) {
	query := `
        SELECT "accessToken", "expires"
        FROM public."Session"
        WHERE "shop" = $1
        ORDER BY "expires" IS NULL DESC, "expires" DESC
    `
	rows, err := db.QueryContext(ctx, query, shop)
	if err != nil {
		return "", err
	}
	defer rows.Close()

	if rows.Next() {
		var accessToken string
		var expires sql.NullString // you can handle the expires field as needed
		if err := rows.Scan(&accessToken, &expires); err != nil {
			return "", err
		}
		return accessToken, nil
	}

	return "", fmt.Errorf("no access token found for shop %s", shop)
}

// ChangeJobStatus updates the status (and possibly the finished_at time) of a job.
func ChangeJobStatus(ctx context.Context, db *sql.DB, jobID string, status string) error {
	// Use parameterized queries to avoid SQL injection.
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	var err error

	switch status {
	case string(JobStatusCompleted), string(JobStatusFailed):
		_, err = db.ExecContext(ctx,
			`UPDATE public."Job" SET status = $1, finished_at = $2 WHERE id = $3`,
			status, now, jobID,
		)
	case string(JobStatusPending):
		_, err = db.ExecContext(ctx,
			`UPDATE public."Job" SET status = $1, finished_at = NULL WHERE id = $2`,
			status, jobID,
		)
	case string(JobStatusCancelled):
		_, err = db.ExecContext(ctx,
			`UPDATE public."Job" SET status = $1, finished_at = $2 WHERE id = $3`,
			status, now, jobID,
		)
	default:
		_, err = db.ExecContext(ctx,
			`UPDATE public."Job" SET status = $1 WHERE id = $2`,
			status, jobID,
		)
	}

	if err != nil {
		return fmt.Errorf("failed to change job status: %w", err)
	}
	return nil
}

// GetJobStatus returns the current status for the given job.
func GetJobStatus(ctx context.Context, db *sql.DB, jobID string) (string, error) {
	query := `SELECT status FROM public."Job" WHERE id = $1`

	var status string
	if err := db.QueryRowContext(ctx, query, jobID).Scan(&status); err != nil {
		if err == sql.ErrNoRows {
			return "", fmt.Errorf("job with ID %s not found", jobID)
		}
		return "", fmt.Errorf("failed to get job status: %w", err)
	}

	return status, nil
}

// GetPendingJobs returns the count of pending jobs for the given shop.
func GetPendingJobs(ctx context.Context, db *sql.DB, shopName string) (int, error) {
	query := `
        SELECT COUNT(*)
        FROM public."Job"
        WHERE status = 'pending' AND shop_name = $1
    `
	var count int
	if err := db.QueryRowContext(ctx, query, shopName).Scan(&count); err != nil {
		return 0, fmt.Errorf("failed to get the count of pending jobs: %w", err)
	}
	return count, nil
}

// PromoteDueScheduledJobs moves due scheduled jobs into the pending state and
// returns the affected shop names.
func PromoteDueScheduledJobs(ctx context.Context, db *sql.DB, limit int) ([]string, error) {
	if limit <= 0 {
		limit = 100
	}

	query := `
        WITH due_jobs AS (
            SELECT id, shop_name
            FROM public."Job"
            WHERE status = 'scheduled'
              AND scheduled_timestamp IS NOT NULL
              AND scheduled_timestamp <> ''
              AND scheduled_timestamp::timestamptz <= NOW()
            ORDER BY scheduled_timestamp::timestamptz ASC, created_at ASC
            LIMIT $1
        ),
        updated AS (
            UPDATE public."Job" job
            SET status = 'pending'
            FROM due_jobs
            WHERE job.id = due_jobs.id
            RETURNING due_jobs.shop_name
        )
        SELECT DISTINCT shop_name
        FROM updated
    `

	rows, err := db.QueryContext(ctx, query, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to promote due scheduled jobs: %w", err)
	}
	defer rows.Close()

	shops := []string{}
	for rows.Next() {
		var shopName string
		if err := rows.Scan(&shopName); err != nil {
			return nil, fmt.Errorf("failed to scan promoted shop name: %w", err)
		}
		shops = append(shops, shopName)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed while reading promoted scheduled jobs: %w", err)
	}

	return shops, nil
}

// GetRunningJobs returns the count of running jobs for the given shop.
func GetRunningJobs(ctx context.Context, db *sql.DB, shopName string) (int, error) {
	query := `
        SELECT COUNT(*)
        FROM public."Job"
        WHERE status = 'running' AND shop_name = $1
    `
	var count int
	if err := db.QueryRowContext(ctx, query, shopName).Scan(&count); err != nil {
		return 0, fmt.Errorf("failed to get the count of running jobs: %w", err)
	}
	return count, nil
}

// SaveGiftCardsToDb saves the gift cards for a job record in a transaction.
func SaveGiftCardsToDb(ctx context.Context, db *sql.DB, giftCards []models.GiftCard, job models.JobData) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	// Rollback in case of error.
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	// Map to simplified gift card objects (with only id and encrypted code).
	type simplifiedGiftCard struct {
		ID             *string `json:"id,omitempty"`
		Code           string  `json:"code"`
		LastCharacters string  `json:"last_characters,omitempty"`
		Balance        string  `json:"balance,omitempty"`
		Currency       string  `json:"currency,omitempty"`
		Value          float64 `json:"value,omitempty"`
		Status         string  `json:"status,omitempty"`
		CreatedAt      string  `json:"created_at,omitempty"`
	}

	var simplified []simplifiedGiftCard
	for _, gc := range giftCards {
		encryptedCode, err := utils.EncryptGiftCard(gc.Code)
		if err != nil {
			_ = tx.Rollback()
			return err
		}
		var idStr *string
		if gc.ID > 0 {
			value := fmt.Sprintf("%.0f", gc.ID)
			idStr = &value
		}

		createdAt := ""
		if !gc.CreatedAt.IsZero() {
			createdAt = gc.CreatedAt.UTC().Format(time.RFC3339)
		}

		simplified = append(simplified, simplifiedGiftCard{
			ID:             idStr,
			Code:           encryptedCode,
			LastCharacters: gc.LastCharacters,
			Balance:        gc.Balance,
			Currency:       gc.Currency,
			Value:          gc.Value,
			Status:         gc.Status,
			CreatedAt:      createdAt,
		})
	}

	// Build an array of JSON strings for each simplified gift card.
	// This ensures that the PostgreSQL driver (pq) can properly
	// convert the Go slice to a valid Postgres array literal.
	jsonArr := make([]string, len(simplified))
	for i, item := range simplified {
		b, err := json.Marshal(item)
		if err != nil {
			_ = tx.Rollback()
			return err
		}
		jsonArr[i] = string(b)
	}

	updateQuery := `
        UPDATE public."Job"
        SET gift_cards = $1, done = $3
        WHERE id = $2;
    `
	// Use pq.Array to pass the slice. For an empty slice, this will
	// correctly produce a '{}' literal for PostgreSQL.
	if _, err = tx.ExecContext(ctx, updateQuery, pq.Array(jsonArr), job.ID, len(giftCards)); err != nil {
		_ = tx.Rollback()
		return err
	}

	if err = tx.Commit(); err != nil {
		return err
	}
	return nil
}

// CompleteJobWithGiftCards atomically saves gift cards and marks the job as
// completed in a single transaction. This prevents the window where the status
// is 'completed' but the gift cards haven't been persisted yet.
func CompleteJobWithGiftCards(ctx context.Context, db *sql.DB, giftCards []models.GiftCard, job models.JobData) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	jsonArr, err := encryptAndSerializeGiftCards(giftCards)
	if err != nil {
		_ = tx.Rollback()
		return err
	}

	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	query := `
        UPDATE public."Job"
        SET gift_cards = $1, done = $2, status = 'completed', finished_at = $3
        WHERE id = $4;
    `
	if _, err = tx.ExecContext(ctx, query, pq.Array(jsonArr), len(giftCards), now, job.ID); err != nil {
		_ = tx.Rollback()
		return err
	}

	if err = tx.Commit(); err != nil {
		return err
	}
	return nil
}

// encryptAndSerializeGiftCards encrypts codes and builds the JSON string array
// used by PostgreSQL to store gift cards.
func encryptAndSerializeGiftCards(giftCards []models.GiftCard) ([]string, error) {
	type simplifiedGiftCard struct {
		ID             *string `json:"id,omitempty"`
		Code           string  `json:"code"`
		LastCharacters string  `json:"last_characters,omitempty"`
		Balance        string  `json:"balance,omitempty"`
		Currency       string  `json:"currency,omitempty"`
		Value          float64 `json:"value,omitempty"`
		Status         string  `json:"status,omitempty"`
		CreatedAt      string  `json:"created_at,omitempty"`
	}

	var simplified []simplifiedGiftCard
	for _, gc := range giftCards {
		encryptedCode, err := utils.EncryptGiftCard(gc.Code)
		if err != nil {
			return nil, err
		}
		var idStr *string
		if gc.ID > 0 {
			value := fmt.Sprintf("%.0f", gc.ID)
			idStr = &value
		}

		createdAt := ""
		if !gc.CreatedAt.IsZero() {
			createdAt = gc.CreatedAt.UTC().Format(time.RFC3339)
		}

		simplified = append(simplified, simplifiedGiftCard{
			ID:             idStr,
			Code:           encryptedCode,
			LastCharacters: gc.LastCharacters,
			Balance:        gc.Balance,
			Currency:       gc.Currency,
			Value:          gc.Value,
			Status:         gc.Status,
			CreatedAt:      createdAt,
		})
	}

	jsonArr := make([]string, len(simplified))
	for i, item := range simplified {
		b, err := json.Marshal(item)
		if err != nil {
			return nil, err
		}
		jsonArr[i] = string(b)
	}
	return jsonArr, nil
}

// CheckpointGiftCards persists partial progress (gift cards + done count)
// without changing the job status. Used during long-running creation loops
// so that crashes don't lose all in-memory progress.
func CheckpointGiftCards(ctx context.Context, db *sql.DB, giftCards []models.GiftCard, job models.JobData) error {
	jsonArr, err := encryptAndSerializeGiftCards(giftCards)
	if err != nil {
		return err
	}

	query := `
        UPDATE public."Job"
        SET gift_cards = $1, done = $2
        WHERE id = $3;
    `
	_, err = db.ExecContext(ctx, query, pq.Array(jsonArr), len(giftCards), job.ID)
	return err
}

// SaveErrorMessage saves an error message to the job record.
func SaveErrorMessage(ctx context.Context, db *sql.DB, jobID string, errorMessage *string) error {
	var msg *string
	if errorMessage == nil || *errorMessage == "" {
		msg = nil
	} else if len(*errorMessage) > 500 {
		truncated := (*errorMessage)[:497] + "..."
		msg = &truncated
	} else {
		msg = errorMessage
	}

	query := `
        UPDATE public."Job"
        SET error_message = $1
        WHERE id = $2;
    `
	if _, err := db.ExecContext(ctx, query, msg, jobID); err != nil {
		return fmt.Errorf("failed to save error message for job %s: %w", jobID, err)
	}
	return nil
}

// HasRunningJob checks if there is any running job for the given shop.
func HasRunningJob(ctx context.Context, db *sql.DB, shopName string) (bool, error) {
	query := `
        SELECT COUNT(*)
        FROM public."Job"
        WHERE status = 'running' AND shop_name = $1
    `
	var count int
	if err := db.QueryRowContext(ctx, query, shopName).Scan(&count); err != nil {
		return false, fmt.Errorf("failed to check for running jobs: %w", err)
	}
	return count > 0, nil
}

// ReconcileStaleRunningJobs marks all running jobs as failed on worker startup.
// In a single-worker deployment, any job still marked running at startup is stale.
func ReconcileStaleRunningJobs(ctx context.Context, db *sql.DB) (int, error) {
	query := `
        UPDATE public."Job"
        SET status = 'failed',
            finished_at = NOW(),
            error_message = 'Worker restarted while job was running. Please retry.'
        WHERE status = 'running'
    `
	result, err := db.ExecContext(ctx, query)
	if err != nil {
		return 0, fmt.Errorf("failed to reconcile stale running jobs: %w", err)
	}
	count, _ := result.RowsAffected()
	return int(count), nil
}

// GetOldestPendingJob returns the oldest pending job for the given shop.
func GetOldestPendingJob(ctx context.Context, db *sql.DB, shopName string) (*models.JobData, error) {
	query := `
        SELECT id, count, value, note, shop_name, user_id, status, created_at, finished_at,
               prefix, postfix, code_length, expire_date, subscription_plan_id,
               customer_ids, scheduled_timestamp, scheduled_message, gift_cards,
               job_type, source_job_id
        FROM public."Job"
        WHERE status = 'pending' AND shop_name = $1
        ORDER BY created_at ASC LIMIT 1
    `
	row := db.QueryRowContext(ctx, query, shopName)

	var job models.JobData
	var note, prefix, postfix, expireDate, customerIDs, scheduledTimestamp, scheduledMessage sql.NullString
	var userID sql.NullInt64
	var finishedAt sql.NullTime
	var subscriptionPlanID sql.NullInt64
	var giftCardsArray pq.StringArray
	var jobType sql.NullString
	var sourceJobID sql.NullString

	err := row.Scan(
		&job.ID,
		&job.Count,
		&job.Value,
		&note,
		&job.ShopName,
		&userID,
		&job.Status,
		&job.CreatedAt,
		&finishedAt,
		&prefix,
		&postfix,
		&job.CodeLength,
		&expireDate,
		&subscriptionPlanID,
		&customerIDs,
		&scheduledTimestamp,
		&scheduledMessage,
		&giftCardsArray,
		&jobType,
		&sourceJobID,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("no pending job found for shop %s", shopName)
		}
		return nil, err
	}
	if note.Valid {
		job.Note = &note.String
	}
	if userID.Valid {
		job.UserID = fmt.Sprintf("%d", userID.Int64)
	}
	if finishedAt.Valid {
		job.FinishedAt = &finishedAt.Time
	}
	if prefix.Valid {
		job.Prefix = &prefix.String
	}
	if postfix.Valid {
		job.Postfix = &postfix.String
	}
	if expireDate.Valid {
		job.ExpireDate = &expireDate.String
	}
	if subscriptionPlanID.Valid {
		tmp := int(subscriptionPlanID.Int64)
		job.SubscriptionPlanID = &tmp
	}
	if customerIDs.Valid {
		job.CustomerIDs = &customerIDs.String
	}
	if scheduledTimestamp.Valid {
		job.ScheduledTimestamp = &scheduledTimestamp.String
	}
	if scheduledMessage.Valid {
		job.ScheduledMessage = &scheduledMessage.String
	}
	job.JobType = "create"
	if jobType.Valid && jobType.String != "" {
		job.JobType = jobType.String
	}
	if sourceJobID.Valid {
		job.SourceJobID = &sourceJobID.String
	}
	// Handle the gift_cards array:
	// Parse each element of the PostgreSQL array as a JSON object.
	// The DB stores fields in snake_case, so we use a matching struct.
	job.GiftCards = []models.GiftCard{}
	if giftCardsArray != nil && len(giftCardsArray) > 0 {
		for _, jsonStr := range giftCardsArray {
			var gc struct {
				ID             string  `json:"id"`
				Code           string  `json:"code"`
				LastCharacters string  `json:"last_characters"`
				Balance        string  `json:"balance"`
				Currency       string  `json:"currency"`
				Value          float64 `json:"value"`
				Status         string  `json:"status"`
				CreatedAt      string  `json:"created_at"`
			}
			if err := json.Unmarshal([]byte(jsonStr), &gc); err != nil {
				return nil, fmt.Errorf("failed to unmarshal gift card: %w", err)
			}
			idFloat := 0.0
			if gc.ID != "" {
				if _, err := fmt.Sscanf(gc.ID, "%f", &idFloat); err != nil {
					return nil, fmt.Errorf("failed to parse gift card ID: %w", err)
				}
			}
			var createdAt time.Time
			if gc.CreatedAt != "" {
				if parsed, parseErr := time.Parse(time.RFC3339, gc.CreatedAt); parseErr == nil {
					createdAt = parsed
				}
			}
			job.GiftCards = append(job.GiftCards, models.GiftCard{
				ID:             idFloat,
				Code:           gc.Code,
				LastCharacters: gc.LastCharacters,
				Balance:        gc.Balance,
				Currency:       gc.Currency,
				Value:          gc.Value,
				Status:         gc.Status,
				CreatedAt:      createdAt,
			})
		}
	}

	return &job, nil
}

// GetSlackWebhookURL retrieves the Slack webhook URL for a given shop.
// Returns empty string if not configured.
func GetSlackWebhookURL(ctx context.Context, db *sql.DB, shopName string) (string, error) {
	query := `SELECT slack_webhook_url FROM public."User" WHERE shop_name = $1`
	var webhookURL sql.NullString
	err := db.QueryRowContext(ctx, query, shopName).Scan(&webhookURL)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", nil
		}
		return "", fmt.Errorf("failed to fetch Slack webhook URL: %w", err)
	}
	if !webhookURL.Valid {
		return "", nil
	}
	return webhookURL.String, nil
}

// CreateAutoDeactivationJobs finds completed jobs that are past their shop's
// auto_deactivate_days threshold and creates pending deactivation jobs for them.
// Returns the distinct shop names that received new deactivation jobs.
func CreateAutoDeactivationJobs(ctx context.Context, db *sql.DB, limit int) ([]string, error) {
	if limit <= 0 {
		limit = 100
	}

	// Find completed jobs eligible for auto-deactivation:
	// - The shop has auto_deactivate_days configured
	// - The job is completed and not yet deactivated
	// - The job is a "create" job (not a deactivation job itself)
	// - The job's created_at + auto_deactivate_days is in the past
	// - No pending/running deactivation job already exists for it
	query := `
		WITH eligible AS (
			SELECT j.id, j.shop_name
			FROM public."Job" j
			JOIN public."User" u ON u.shop_name = j.shop_name
			WHERE j.status = 'completed'
			  AND j.deactivated_at IS NULL
			  AND j.job_type = 'create'
			  AND u.auto_deactivate_days IS NOT NULL
			  AND j.created_at + (u.auto_deactivate_days || ' days')::interval <= NOW()
			  AND NOT EXISTS (
				SELECT 1 FROM public."Job" dj
				WHERE dj.source_job_id = j.id
				  AND dj.job_type = 'deactivate'
				  AND dj.status IN ('pending', 'running')
			  )
			ORDER BY j.created_at ASC
			LIMIT $1
		),
		inserted AS (
			INSERT INTO public."Job" (id, job_type, source_job_id, count, shop_name, status, created_at, value)
			SELECT gen_random_uuid()::text, 'deactivate', e.id, 0, e.shop_name, 'pending', NOW(), 0
			FROM eligible e
			RETURNING shop_name
		)
		SELECT DISTINCT shop_name FROM inserted
	`

	rows, err := db.QueryContext(ctx, query, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to create auto-deactivation jobs: %w", err)
	}
	defer rows.Close()

	shops := []string{}
	for rows.Next() {
		var shopName string
		if err := rows.Scan(&shopName); err != nil {
			return nil, fmt.Errorf("failed to scan auto-deactivation shop name: %w", err)
		}
		shops = append(shops, shopName)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed while reading auto-deactivation results: %w", err)
	}

	return shops, nil
}

// MarkSourceJobDeactivated sets the deactivated_at timestamp on the source job
// after all its gift cards have been deactivated.
func MarkSourceJobDeactivated(ctx context.Context, db *sql.DB, sourceJobID string) error {
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	_, err := db.ExecContext(ctx,
		`UPDATE public."Job" SET deactivated_at = $1 WHERE id = $2`,
		now, sourceJobID,
	)
	if err != nil {
		return fmt.Errorf("failed to mark source job as deactivated: %w", err)
	}
	return nil
}

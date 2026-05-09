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
// It is idempotent: if the recipient row was already processed, it skips the counter increment.
func MarkStoreCreditRecipientSucceeded(
	ctx context.Context, db *sql.DB,
	jobID, customerID, accountID, transactionID string,
) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	result, err := tx.ExecContext(ctx, `
		UPDATE store_credit_job_recipient
		SET status='succeeded', account_id=$1, transaction_id=$2, processed_at=NOW()
		WHERE job_id=$3 AND customer_id=$4 AND status='pending'
	`, accountID, transactionID, jobID, customerID)
	if err != nil {
		return err
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return tx.Commit() // idempotent no-op — recipient already processed
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE store_credit_job SET done = done + 1 WHERE id=$1
	`, jobID); err != nil {
		return err
	}

	return tx.Commit()
}

// MarkStoreCreditRecipientFailed updates the recipient and increments the parent's failed counter.
// It is idempotent: if the recipient row was already processed, it skips the counter increment.
func MarkStoreCreditRecipientFailed(
	ctx context.Context, db *sql.DB,
	jobID, customerID, errorMessage string,
) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	result, err := tx.ExecContext(ctx, `
		UPDATE store_credit_job_recipient
		SET status='failed', error_message=$1, processed_at=NOW()
		WHERE job_id=$2 AND customer_id=$3 AND status='pending'
	`, errorMessage, jobID, customerID)
	if err != nil {
		return err
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return tx.Commit() // idempotent no-op — recipient already processed
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE store_credit_job SET failed = failed + 1 WHERE id=$1
	`, jobID); err != nil {
		return err
	}

	return tx.Commit()
}

// FinalizeStoreCreditJob sets the final status and finished_at based on current counters.
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

// ReconcileStaleRunningStoreCreditJobs marks any 'running' store credit jobs as
// 'failed' at startup. In a single-worker setup, any 'running' row at startup is
// stale (the previous worker died mid-job).
func ReconcileStaleRunningStoreCreditJobs(ctx context.Context, db *sql.DB) (int, error) {
	res, err := db.ExecContext(ctx, `
		UPDATE store_credit_job
		SET status='failed',
		    error_message=COALESCE(error_message, 'Worker restart — job orphaned'),
		    finished_at=NOW()
		WHERE status='running'
	`)
	if err != nil {
		return 0, fmt.Errorf("reconcile stale store credit jobs: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, err
	}
	return int(n), nil
}

// PromoteDueScheduledStoreCreditJobs atomically flips due scheduled jobs to
// 'running' and returns their IDs + shops so the caller can dispatch them.
// Mirrors PromoteDueScheduledJobs in db.go for gift-card jobs.
func PromoteDueScheduledStoreCreditJobs(ctx context.Context, db *sql.DB, limit int) ([]StoreCreditJob, error) {
	rows, err := db.QueryContext(ctx, `
		UPDATE store_credit_job SET status='running'
		WHERE id IN (
			SELECT id FROM store_credit_job
			WHERE status='scheduled'
			  AND scheduled_timestamp::timestamptz <= NOW()
			ORDER BY scheduled_timestamp::timestamptz ASC
			FOR UPDATE SKIP LOCKED
			LIMIT $1
		)
		RETURNING id, shop_name
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

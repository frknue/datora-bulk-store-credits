package db

import (
	"context"
	"errors"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

// ClaimJob must serialize concurrent claims for the same shop. Locking only
// the target job row is not enough: two concurrent claims for different
// pending jobs in the same shop lock different rows, both observe
// runningCount = 0, and both transition to running, breaking the
// single-worker-per-shop invariant. The fix is a transaction-scoped Postgres
// advisory lock keyed on shop_name, taken between the row lock and the
// count check.

func TestClaimJobAcquiresShopAdvisoryLockBetweenRowLockAndCount(t *testing.T) {
	sqlDB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("open sqlmock: %v", err)
	}
	defer sqlDB.Close()

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT status, shop_name FROM public."Job" WHERE id = $1 FOR UPDATE`,
	)).
		WithArgs("job-1").
		WillReturnRows(sqlmock.NewRows([]string{"status", "shop_name"}).
			AddRow("pending", "shop-A"))
	mock.ExpectExec(regexp.QuoteMeta(
		`SELECT pg_advisory_xact_lock(hashtext($1))`,
	)).
		WithArgs("shop-A").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT COUNT(*) FROM public."Job" WHERE shop_name = $1 AND status = 'running'`,
	)).
		WithArgs("shop-A").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectExec(regexp.QuoteMeta(
		`UPDATE public."Job" SET status = 'running' WHERE id = $1`,
	)).
		WithArgs("job-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	if err := ClaimJob(context.Background(), sqlDB, "job-1"); err != nil {
		t.Fatalf("ClaimJob: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestClaimJobReturnsShopHasRunningJobAfterAdvisoryLock(t *testing.T) {
	sqlDB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("open sqlmock: %v", err)
	}
	defer sqlDB.Close()

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT status, shop_name FROM public."Job" WHERE id = $1 FOR UPDATE`,
	)).
		WithArgs("job-2").
		WillReturnRows(sqlmock.NewRows([]string{"status", "shop_name"}).
			AddRow("pending", "shop-B"))
	mock.ExpectExec(regexp.QuoteMeta(
		`SELECT pg_advisory_xact_lock(hashtext($1))`,
	)).
		WithArgs("shop-B").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT COUNT(*) FROM public."Job" WHERE shop_name = $1 AND status = 'running'`,
	)).
		WithArgs("shop-B").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectRollback()

	err = ClaimJob(context.Background(), sqlDB, "job-2")
	if !errors.Is(err, ErrShopHasRunningJob) {
		t.Fatalf("expected ErrShopHasRunningJob, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestClaimJobReturnsJobNotPendingWithoutAdvisoryLock(t *testing.T) {
	sqlDB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("open sqlmock: %v", err)
	}
	defer sqlDB.Close()

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT status, shop_name FROM public."Job" WHERE id = $1 FOR UPDATE`,
	)).
		WithArgs("job-3").
		WillReturnRows(sqlmock.NewRows([]string{"status", "shop_name"}).
			AddRow("running", "shop-C"))
	mock.ExpectRollback()

	err = ClaimJob(context.Background(), sqlDB, "job-3")
	if !errors.Is(err, ErrJobNotPending) {
		t.Fatalf("expected ErrJobNotPending, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

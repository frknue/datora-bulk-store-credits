package handler

import (
	"context"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/Datora-Websystems/datora-bulk-gift-cards/services/worker/internal/db"
	"github.com/Datora-Websystems/datora-bulk-gift-cards/services/worker/internal/models"
	"github.com/go-redis/redis/v8"
)

type fakeJobStatusCache struct {
	hashes      map[string]map[string]interface{}
	expirations map[string]time.Duration
}

func newFakeJobStatusCache() *fakeJobStatusCache {
	return &fakeJobStatusCache{
		hashes:      make(map[string]map[string]interface{}),
		expirations: make(map[string]time.Duration),
	}
}

func (f *fakeJobStatusCache) HSet(ctx context.Context, key string, values ...interface{}) *redis.IntCmd {
	if _, ok := f.hashes[key]; !ok {
		f.hashes[key] = make(map[string]interface{})
	}

	if len(values) == 1 {
		if valueMap, ok := values[0].(map[string]interface{}); ok {
			for field, value := range valueMap {
				f.hashes[key][field] = value
			}
		}
	} else {
		for i := 0; i+1 < len(values); i += 2 {
			field, ok := values[i].(string)
			if !ok {
				continue
			}
			f.hashes[key][field] = values[i+1]
		}
	}

	cmd := redis.NewIntCmd(ctx)
	cmd.SetVal(1)
	return cmd
}

func (f *fakeJobStatusCache) Expire(ctx context.Context, key string, expiration time.Duration) *redis.BoolCmd {
	f.expirations[key] = expiration
	cmd := redis.NewBoolCmd(ctx)
	cmd.SetVal(true)
	return cmd
}

func TestFinalizeCreateJobResultKeepsCancelledState(t *testing.T) {
	t.Setenv("GIFT_CARD_ENCRYPTION_KEY", "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff")

	sqlDB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer sqlDB.Close()

	job := models.JobData{
		ID:    "job-cancelled",
		Count: 5,
	}
	giftCards := []models.GiftCard{
		{ID: 101, Code: "CNCL-0001", Currency: "EUR", Value: 1},
		{ID: 102, Code: "CNCL-0002", Currency: "EUR", Value: 1},
	}
	redisKey := "job_status:job-cancelled"
	statusCache := newFakeJobStatusCache()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT status FROM public."Job" WHERE id = $1`)).
		WithArgs(job.ID).
		WillReturnRows(sqlmock.NewRows([]string{"status"}).AddRow(string(db.JobStatusCancelled)))

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`SET gift_cards = $1, done = $3`)).
		WithArgs(sqlmock.AnyArg(), job.ID, len(giftCards)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	mock.ExpectExec(regexp.QuoteMeta(`SET status = $1, finished_at = $2 WHERE id = $3`)).
		WithArgs(string(db.JobStatusCancelled), sqlmock.AnyArg(), job.ID).
		WillReturnResult(sqlmock.NewResult(0, 1))

	finalStatus, err := finalizeCreateJobResult(context.Background(), sqlDB, statusCache, redisKey, job, giftCards)
	if err != nil {
		t.Fatalf("finalizeCreateJobResult() error = %v", err)
	}
	if finalStatus != string(db.JobStatusCancelled) {
		t.Fatalf("expected final status %q, got %q", db.JobStatusCancelled, finalStatus)
	}

	fields := statusCache.hashes[redisKey]
	if fields["status"] != "cancelled" {
		t.Fatalf("expected redis status to be cancelled, got %v", fields["status"])
	}
	if fields["done"] != len(giftCards) {
		t.Fatalf("expected redis done to be %d, got %v", len(giftCards), fields["done"])
	}
	if fields["total"] != job.Count {
		t.Fatalf("expected redis total to be %d, got %v", job.Count, fields["total"])
	}
	if statusCache.expirations[redisKey] != 24*time.Hour {
		t.Fatalf("expected redis expiration to be 24h, got %v", statusCache.expirations[redisKey])
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

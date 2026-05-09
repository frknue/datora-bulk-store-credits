package handler

import (
	"context"
	"database/sql"
	"log"
	"os"
	"time"

	"github.com/Datora-Websystems/datora-bulk-gift-cards/services/worker/internal/db"
	_ "github.com/lib/pq" // PostgreSQL driver
)

const (
	scheduledDispatchInterval      = 30 * time.Second
	autoDeactivationCheckInterval  = 5 * time.Minute
	scheduledDispatchBatch         = 100
)

// StartBackgroundDispatchers starts long-running background loops owned by the worker.
func StartBackgroundDispatchers() {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("PANIC recovered in scheduled dispatch loop: %v — restarting", r)
				time.Sleep(5 * time.Second)
				StartBackgroundDispatchers()
			}
		}()
		runScheduledDispatchLoop()
	}()

	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("PANIC recovered in auto-deactivation loop: %v — restarting", r)
				time.Sleep(5 * time.Second)
				// Restart only the auto-deactivation loop.
				go StartAutoDeactivationLoop()
			}
		}()
		StartAutoDeactivationLoop()
	}()

	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("PANIC recovered in store credit dispatch loop: %v — restarting", r)
				time.Sleep(5 * time.Second)
				go StartStoreCreditScheduledDispatchLoop()
			}
		}()
		StartStoreCreditScheduledDispatchLoop()
	}()
}

func runScheduledDispatchLoop() {
	dispatchDueScheduledJobs()

	ticker := time.NewTicker(scheduledDispatchInterval)
	defer ticker.Stop()

	for range ticker.C {
		dispatchDueScheduledJobs()
	}
}

// StartAutoDeactivationLoop runs the auto-deactivation check every 5 minutes.
func StartAutoDeactivationLoop() {
	checkAutoDeactivation()

	ticker := time.NewTicker(autoDeactivationCheckInterval)
	defer ticker.Stop()

	for range ticker.C {
		checkAutoDeactivation()
	}
}

func dispatchDueScheduledJobs() {
	dbURL := NormalizeDatabaseURL(os.Getenv("DATABASE_URL"))
	redisURL := os.Getenv("REDIS_URL")
	serviceURL := os.Getenv("SERVICE_URL")
	presharedKey := os.Getenv("PRESHARED_AUTH_HEADER_KEY")
	if presharedKey == "" {
		presharedKey = "x-api-key"
	}
	presharedValue := os.Getenv("PRESHARED_AUTH_HEADER_VALUE")

	if dbURL == "" || redisURL == "" || serviceURL == "" || presharedValue == "" {
		log.Printf("Skipping scheduled dispatch because required worker env vars are missing")
		return
	}

	sqlDB, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Printf("Error opening database for scheduled dispatch: %v", err)
		return
	}
	defer sqlDB.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	shops, err := db.PromoteDueScheduledJobs(ctx, sqlDB, scheduledDispatchBatch)
	if err != nil {
		log.Printf("Error promoting due scheduled jobs: %v", err)
		return
	}

	if len(shops) == 0 {
		return
	}

	log.Printf("Promoted due scheduled jobs for %d shop(s)", len(shops))
	dispatchPendingJobsForShops(ctx, sqlDB, shops, dbURL, redisURL, serviceURL, presharedKey, presharedValue)
}

func checkAutoDeactivation() {
	dbURL := NormalizeDatabaseURL(os.Getenv("DATABASE_URL"))
	redisURL := os.Getenv("REDIS_URL")
	serviceURL := os.Getenv("SERVICE_URL")
	presharedKey := os.Getenv("PRESHARED_AUTH_HEADER_KEY")
	if presharedKey == "" {
		presharedKey = "x-api-key"
	}
	presharedValue := os.Getenv("PRESHARED_AUTH_HEADER_VALUE")

	if dbURL == "" || redisURL == "" || serviceURL == "" || presharedValue == "" {
		return
	}

	sqlDB, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Printf("Error opening database for auto-deactivation: %v", err)
		return
	}
	defer sqlDB.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	shops, err := db.CreateAutoDeactivationJobs(ctx, sqlDB, scheduledDispatchBatch)
	if err != nil {
		log.Printf("Error creating auto-deactivation jobs: %v", err)
		return
	}

	if len(shops) == 0 {
		return
	}

	log.Printf("Created auto-deactivation jobs for %d shop(s)", len(shops))
	dispatchPendingJobsForShops(ctx, sqlDB, shops, dbURL, redisURL, serviceURL, presharedKey, presharedValue)
}

// StartStoreCreditScheduledDispatchLoop polls for due scheduled store credit jobs
// and dispatches them in-process using the same handler logic as the HTTP path.
func StartStoreCreditScheduledDispatchLoop() {
	dispatchDueScheduledStoreCreditJobs()
	ticker := time.NewTicker(scheduledDispatchInterval)
	defer ticker.Stop()
	for range ticker.C {
		dispatchDueScheduledStoreCreditJobs()
	}
}

func dispatchDueScheduledStoreCreditJobs() {
	dbURL := NormalizeDatabaseURL(os.Getenv("DATABASE_URL"))
	sqlDB, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Printf("store credit scheduler: db open: %v", err)
		return
	}
	defer sqlDB.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	jobs, err := db.PromoteDueScheduledStoreCreditJobs(ctx, sqlDB, scheduledDispatchBatch)
	if err != nil {
		log.Printf("store credit scheduler: promote due: %v", err)
		return
	}

	for _, j := range jobs {
		select {
		case jobSemaphore <- struct{}{}:
		default:
			log.Printf("store credit scheduler: semaphore full, will retry next tick")
			return
		}
		jobID, shop := j.ID, j.ShopName
		go func() {
			defer func() { <-jobSemaphore }()
			ownDB, err := sql.Open("postgres", dbURL)
			if err != nil {
				log.Printf("store credit scheduler: db open for job %s: %v", jobID, err)
				return
			}
			defer ownDB.Close()
			ctx := context.Background()
			claimed, err := db.FetchStoreCreditJob(ctx, ownDB, jobID)
			if err != nil {
				log.Printf("store credit scheduler: fetch job %s: %v", jobID, err)
				return
			}
			if err := processAlreadyClaimedStoreCreditJob(ctx, ownDB, claimed, shop); err != nil {
				log.Printf("store credit scheduler: job %s failed: %v", jobID, err)
			}
		}()
	}
}

func dispatchPendingJobsForShops(ctx context.Context, sqlDB *sql.DB, shops []string, dbURL, redisURL, serviceURL, presharedKey, presharedValue string) {
	for _, shopName := range shops {
		nextJob, err := db.GetOldestPendingJob(ctx, sqlDB, shopName)
		if err != nil {
			log.Printf("Error fetching next pending job for shop %s: %v", shopName, err)
			continue
		}
		if nextJob == nil {
			continue
		}

		if err := db.ClaimJob(ctx, sqlDB, nextJob.ID); err != nil {
			log.Printf("Could not claim job %s for shop %s: %v", nextJob.ID, shopName, err)
			continue
		}

		log.Printf("Dispatching claimed job %s for shop %s", nextJob.ID, shopName)
		go func(id, shop string) {
			jobSemaphore <- struct{}{}
			defer func() { <-jobSemaphore }()
			defer func() {
				if r := recover(); r != nil {
					log.Printf("PANIC recovered in scheduled job %s: %v", id, r)
				}
			}()
			processJobAsync(id, shop, dbURL, redisURL, serviceURL, presharedKey, presharedValue)
		}(nextJob.ID, nextJob.ShopName)
	}
}

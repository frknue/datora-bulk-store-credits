package main

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Datora-Websystems/datora-bulk-gift-cards/services/worker/internal/db"
	"github.com/Datora-Websystems/datora-bulk-gift-cards/services/worker/internal/handler"
	"github.com/Datora-Websystems/datora-bulk-gift-cards/services/worker/internal/middleware"
	"github.com/Datora-Websystems/datora-bulk-gift-cards/services/worker/internal/utils"
	"github.com/gorilla/mux"
	_ "github.com/lib/pq"
)

func main() {
	// Validate critical configuration at startup so misconfigurations are caught early.
	if err := utils.ValidateEncryptionKey(); err != nil {
		log.Fatalf("Encryption key validation failed: %v", err)
	}

	for _, envVar := range []string{"DATABASE_URL", "REDIS_URL", "SERVICE_URL", "PRESHARED_AUTH_HEADER_VALUE"} {
		if os.Getenv(envVar) == "" {
			log.Fatalf("Required environment variable %s is not set", envVar)
		}
	}

	// Reconcile stale running jobs before accepting any traffic.
	// In a single-worker setup, any job marked 'running' at startup is stale.
	reconcileStaleJobs()

	router := mux.NewRouter()

	handler.StartBackgroundDispatchers()

	// Public routes (no authentication)
	router.HandleFunc("/health", handler.HealthCheckHandler)

	// Authenticated routes
	authenticatedRouter := mux.NewRouter()
	authenticatedRouter.HandleFunc("/run-job", handler.RunJobHandler)
	authenticatedRouter.HandleFunc("/run-store-credit-job", handler.RunStoreCreditJobHandler)

	// Apply authentication middleware only to authenticated routes
	securedRouter := middleware.Authenticate(authenticatedRouter)

	// Main router combines both
	rootRouter := mux.NewRouter()
	rootRouter.PathPrefix("/health").Handler(router)  // Keep health check public
	rootRouter.PathPrefix("/").Handler(securedRouter) // Secure other routes

	srv := &http.Server{
		Addr:    ":8080",
		Handler: rootRouter,
	}

	// Start server in a goroutine so we can handle shutdown signals
	go func() {
		log.Println("Starting server on :8080")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()

	// Wait for SIGINT or SIGTERM (sent by Fly.io during deploys)
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit
	log.Printf("Received signal %s, shutting down gracefully...", sig)

	// Give in-flight HTTP requests time to complete, but don't wait for background jobs.
	// Any jobs still running when the process exits will be marked failed by
	// reconcileStaleJobs on the next startup.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("HTTP server shutdown error: %v", err)
	}

	log.Println("Server stopped")
}

func reconcileStaleJobs() {
	dbURL := handler.NormalizeDatabaseURL(os.Getenv("DATABASE_URL"))
	sqlDB, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatalf("Failed to open database for stale-job reconciliation: %v", err)
	}
	defer sqlDB.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	count, err := db.ReconcileStaleRunningJobs(ctx, sqlDB)
	if err != nil {
		log.Fatalf("Failed to reconcile stale running jobs: %v", err)
	}
	if count > 0 {
		log.Printf("Reconciled %d stale running job(s) on startup", count)
	}

	storeCreditCount, err := db.ReconcileStaleRunningStoreCreditJobs(ctx, sqlDB)
	if err != nil {
		log.Fatalf("Failed to reconcile stale running store credit jobs: %v", err)
	}
	if storeCreditCount > 0 {
		log.Printf("Reconciled %d stale running store credit job(s) on startup", storeCreditCount)
	}
}

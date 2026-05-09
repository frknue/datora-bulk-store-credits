#!/usr/bin/env bash
set -e

SHOPIFY_ARGS=("$@")

# ──────────────────────────────────────────────────────────────
# Unified dev startup: Redis + Go worker + shopify app dev
# All child processes are killed when this script exits (Ctrl+C)
# ──────────────────────────────────────────────────────────────

PIDS=()
REDIS_CONTAINER="datora-redis-dev"

cleanup() {
  echo ""
  echo "🛑 Shutting down all services..."

  # Kill child processes
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null || true
    fi
  done

  # Stop Redis container
  if docker ps -q -f name="$REDIS_CONTAINER" | grep -q .; then
    echo "   Stopping Redis container..."
    docker stop "$REDIS_CONTAINER" >/dev/null 2>&1 || true
  fi

  echo "✅ All services stopped."
  exit 0
}

trap cleanup INT TERM EXIT

# ── 1. Redis ─────────────────────────────────────────────────
echo "🔴 Starting Redis..."
if docker ps -q -f name="$REDIS_CONTAINER" | grep -q .; then
  echo "   Redis container already running."
else
  # Remove stopped container with same name if exists
  docker rm -f "$REDIS_CONTAINER" 2>/dev/null || true
  docker run --rm -d --name "$REDIS_CONTAINER" -p 6379:6379 redis:7-alpine >/dev/null
  echo "   Redis started on port 6379."
fi

# ── 2. Go Worker ─────────────────────────────────────────────
echo "🔧 Starting Go worker..."
(
  cd services/worker
  if command -v air >/dev/null 2>&1; then
    air -c .air.toml
  else
    echo "   air not found; falling back to go run."
    go run ./cmd/worker/main.go
  fi
) &
PIDS+=($!)
echo "   Go worker hot reload watching on port 8080."

# Wait a moment for the worker to initialize
sleep 2

# ── 3. Shopify App Dev ───────────────────────────────────────
echo "🚀 Starting shopify app dev..."
shopify app dev "${SHOPIFY_ARGS[@]}" &
PIDS+=($!)

# Wait for any child to exit
wait

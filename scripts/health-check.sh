#!/bin/bash
# PostGo — Automated Health Check Script
# Run this after `docker compose up -d --build` to verify everything works.
#
# Usage:
#   bash scripts/health-check.sh
#
# Exit codes:
#   0 = all checks passed
#   1 = one or more checks failed

# NOTE: do NOT use `set -e` here — `((PASS++))` returns exit code 1 when
# PASS was 0 before (because the expression evaluates to 0 = "false" in
# bash arithmetic). With `set -e`, that kills the script on the first
# pass. We handle errors explicitly instead.

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASS=0
FAIL=0
WARN=0

log_pass() { echo -e "${GREEN}✓ PASS${NC}: $1"; PASS=$((PASS + 1)); }
log_fail() { echo -e "${RED}✗ FAIL${NC}: $1"; FAIL=$((FAIL + 1)); }
log_warn() { echo -e "${YELLOW}⚠ WARN${NC}: $1"; WARN=$((WARN + 1)); }

echo "=========================================="
echo "  PostGo Health Check"
echo "=========================================="
echo ""

# ─── 1. Container status ──────────────────────────────────────────
echo "── 1. Container Status ──"
EXPECTED_CONTAINERS=("postgo-web" "postgo-worker-1" "postgo-worker-2" "postgo-worker-3" "postgo-postgres" "postgo-redis")

for container in "${EXPECTED_CONTAINERS[@]}"; do
  STATUS=$(docker inspect --format='{{.State.Status}}' "$container" 2>/dev/null || echo "missing")
  if [ "$STATUS" = "running" ]; then
    log_pass "$container is running"
  else
    log_fail "$container is $STATUS (expected: running)"
  fi
done
echo ""

# ─── 2. Health endpoint ───────────────────────────────────────────
echo "── 2. Health Endpoint ──"
HEALTH_RESPONSE=$(curl -s http://localhost:3001/api/health 2>/dev/null || echo "FAILED")

if [ "$HEALTH_RESPONSE" = "FAILED" ]; then
  log_fail "Cannot reach http://localhost:3001/api/health"
else
  HEALTH_STATUS=$(echo "$HEALTH_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','unknown'))" 2>/dev/null || echo "parse-error")

  if [ "$HEALTH_STATUS" = "ok" ]; then
    log_pass "Health endpoint returns 'ok'"

    # Check DB
    DB_STATUS=$(echo "$HEALTH_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('db','unknown'))" 2>/dev/null || echo "parse-error")
    if [ "$DB_STATUS" = "ok" ]; then
      log_pass "Database connection OK"
    else
      log_fail "Database status: $DB_STATUS"
    fi

    # Check Redis
    REDIS_STATUS=$(echo "$HEALTH_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('redis','unknown'))" 2>/dev/null || echo "parse-error")
    if [ "$REDIS_STATUS" = "ok" ]; then
      log_pass "Redis connection OK"
    else
      log_fail "Redis status: $REDIS_STATUS"
    fi
  else
    log_fail "Health status: $HEALTH_STATUS (expected: ok)"
  fi
fi
echo ""

# ─── 3. Redis connection count ────────────────────────────────────
echo "── 3. Redis Connection Count ──"
REDIS_CLIENTS=$(docker exec postgo-redis redis-cli info clients 2>/dev/null | grep "^connected_clients:" | cut -d: -f2 | tr -d '\r')

if [ -z "$REDIS_CLIENTS" ]; then
  log_fail "Cannot get Redis client count"
else
  # Healthy range: 4-12 clients
  # 1 web (queue) + 3 workers + 1-2 monitor/health + 1-2 BullMQ internals = 5-8 typical
  # Up to 12 is fine. Above 15 = warning. Above 20 = likely leak.
  if [ "$REDIS_CLIENTS" -ge 4 ] && [ "$REDIS_CLIENTS" -le 12 ]; then
    log_pass "Redis connected_clients: $REDIS_CLIENTS (healthy range: 4-12)"
  elif [ "$REDIS_CLIENTS" -ge 13 ] && [ "$REDIS_CLIENTS" -le 20 ]; then
    log_warn "Redis connected_clients: $REDIS_CLIENTS (slightly high, monitor for leaks)"
  elif [ "$REDIS_CLIENTS" -gt 20 ]; then
    log_fail "Redis connected_clients: $REDIS_CLIENTS (HIGH — possible leak)"
  else
    log_warn "Redis connected_clients: $REDIS_CLIENTS (low — workers may not be connected)"
  fi
fi

# Check rejected connections (should be 0)
REJECTED=$(docker exec postgo-redis redis-cli info stats 2>/dev/null | grep "^rejected_connections:" | cut -d: -f2 | tr -d '\r')
if [ "$REJECTED" = "0" ]; then
  log_pass "Redis rejected_connections: 0 (no leaks)"
else
  log_fail "Redis rejected_connections: $REJECTED (leak detected!)"
fi
echo ""

# ─── 4. Worker verification ───────────────────────────────────────
echo "── 4. Worker Verification ──"
WORKER_COUNT=$(docker compose ps 2>/dev/null | grep -c "worker" || echo "0")

if [ "$WORKER_COUNT" -ge 3 ]; then
  log_pass "3 workers running ($WORKER_COUNT found)"
else
  log_fail "Expected 3 workers, found $WORKER_COUNT"
fi

# Check each worker's Redis connection
for i in 1 2 3; do
  WORKER_LOG=$(docker logs postgo-worker-$i 2>&1 | grep "Connected to Redis" | tail -1)
  if [ -n "$WORKER_LOG" ]; then
    log_pass "worker-$i connected to Redis"
  else
    log_fail "worker-$i NOT connected to Redis (check: docker logs postgo-worker-$i)"
  fi
done
echo ""

# ─── 5. Database verification ─────────────────────────────────────
echo "── 5. Database Verification ──"

# Check AccountConnectionLog table exists
TABLE_COUNT=$(docker exec postgo-postgres psql -U postgo -t -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'AccountConnectionLog';" 2>/dev/null | tr -d ' ')

if [ "$TABLE_COUNT" = "1" ]; then
  log_pass "AccountConnectionLog table exists"
else
  log_fail "AccountConnectionLog table missing — run: docker compose exec web npx prisma db push"
fi

# Check User table has planExpiresAt column
COLUMN_COUNT=$(docker exec postgo-postgres psql -U postgo -t -c \
  "SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'User' AND column_name = 'planExpiresAt';" 2>/dev/null | tr -d ' ')

if [ "$COLUMN_COUNT" = "1" ]; then
  log_pass "User.planExpiresAt column exists"
else
  log_fail "User.planExpiresAt column missing — run: docker compose exec web npx prisma db push"
fi

# Check PostgreSQL connection count
PG_CONNS=$(docker exec postgo-postgres psql -U postgo -t -c \
  "SELECT count(*) FROM pg_stat_activity;" 2>/dev/null | tr -d ' ')

if [ -n "$PG_CONNS" ] && [ "$PG_CONNS" -lt 100 ]; then
  log_pass "PostgreSQL connections: $PG_CONNS (healthy, < 100)"
else
  log_warn "PostgreSQL connections: $PG_CONNS (high, monitor)"
fi
echo ""

# ─── 6. Worker concurrency test (queue processing) ────────────────
echo "── 6. Queue Processing Test ──"
# Check if workers are reporting queue stats
WORKER_STATS=$(docker logs postgo-worker-1 2>&1 | grep "Queue Status" | tail -1)
if [ -n "$WORKER_STATS" ]; then
  log_pass "Workers are reporting queue stats"
else
  log_warn "No queue stats yet (wait 30s after startup, then re-run)"
fi
echo ""

# ─── 7. Summary ───────────────────────────────────────────────────
echo "=========================================="
echo "  SUMMARY"
echo "=========================================="
echo -e "  ${GREEN}Passed: $PASS${NC}"
echo -e "  ${RED}Failed: $FAIL${NC}"
echo -e "  ${YELLOW}Warnings: $WARN${NC}"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}❌ $FAIL check(s) failed. Fix issues before deploying.${NC}"
  exit 1
elif [ "$WARN" -gt 0 ]; then
  echo -e "${YELLOW}⚠ $WARN warning(s). Monitor but OK to proceed.${NC}"
  exit 0
else
  echo -e "${GREEN}✅ All checks passed! Ready to push to GitHub + deploy to Coolify.${NC}"
  exit 0
fi

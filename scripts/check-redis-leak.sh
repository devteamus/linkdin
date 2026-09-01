#!/bin/bash
# PostGo — Redis Connection Leak Detector
# Monitors Redis connections over time to detect leaks.
#
# Usage:
#   bash scripts/check-redis-leak.sh                 # Check once
#   bash scripts/check-redis-leak.sh --watch         # Continuous monitoring (Ctrl+C to stop)
#   bash scripts/check-redis-leak.sh --restart-test  # Restart containers 10x and check
#
# NOTE: do NOT use `set -e` — same reason as health-check.sh.

REDIS_CONTAINER="postgo-redis"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

get_redis_clients() {
  docker exec $REDIS_CONTAINER redis-cli info clients 2>/dev/null | grep "^connected_clients:" | cut -d: -f2 | tr -d '\r'
}

get_rejected() {
  docker exec $REDIS_CONTAINER redis-cli info stats 2>/dev/null | grep "^rejected_connections:" | cut -d: -f2 | tr -d '\r'
}

get_redis_memory() {
  docker exec $REDIS_CONTAINER redis-cli info memory 2>/dev/null | grep "^used_memory_human:" | cut -d: -f2 | tr -d '\r'
}

check_once() {
  echo -e "${BLUE}=== Redis Status Check ===${NC}"
  echo "Timestamp: $(date '+%Y-%m-%d %H:%M:%S')"
  echo ""

  CLIENTS=$(get_redis_clients)
  REJECTED=$(get_rejected)
  MEMORY=$(get_redis_memory)

  echo -e "Connected clients: ${YELLOW}$CLIENTS${NC}"
  echo -e "Rejected connections: ${YELLOW}$REJECTED${NC}"
  echo -e "Memory used: ${YELLOW}$MEMORY${NC}"
  echo ""

  # ─── Interpretation ───
  echo "── Interpretation ──"

  if [ -z "$CLIENTS" ]; then
    echo -e "${RED}✗ Cannot connect to Redis. Is the container running?${NC}"
    return 1
  fi

  # Healthy range: 4-12 clients
  # 1 web (queue) + 3 workers + 1-2 monitor/health + 1-2 BullMQ internals = 5-9 typical
  if [ "$CLIENTS" -ge 4 ] && [ "$CLIENTS" -le 12 ]; then
    echo -e "${GREEN}✓ Client count normal ($CLIENTS — healthy range: 4-12)${NC}"
    echo "  Breakdown: 1 web + 3 workers + 1-2 monitor + 1-2 BullMQ internals"
  elif [ "$CLIENTS" -ge 13 ] && [ "$CLIENTS" -le 20 ]; then
    echo -e "${YELLOW}⚠ Client count slightly elevated ($CLIENTS) — monitor${NC}"
  elif [ "$CLIENTS" -gt 20 ]; then
    echo -e "${RED}✗ Client count HIGH ($CLIENTS) — possible leak!${NC}"
    echo ""
    echo "Active clients:"
    docker exec $REDIS_CONTAINER redis-cli client list 2>/dev/null | head -20
  else
    echo -e "${YELLOW}⚠ Client count low ($CLIENTS) — workers may not be connected${NC}"
  fi

  if [ "$REJECTED" = "0" ]; then
    echo -e "${GREEN}✓ No rejected connections (no maxclients issues)${NC}"
  else
    echo -e "${RED}✗ $REJECTED connections rejected — LEAK DETECTED!${NC}"
  fi

  echo ""

  # ─── Per-worker client names ───
  echo "── Worker client names ──"
  docker exec $REDIS_CONTAINER redis-cli client list 2>/dev/null | grep -oP 'name=[^ ]+' | sort -u | while read name; do
    echo "  $name"
  done
  echo ""
}

watch_mode() {
  echo -e "${BLUE}=== Redis Leak Watch Mode (Ctrl+C to stop) ===${NC}"
  echo "Monitoring every 10 seconds. Press Ctrl+C to stop."
  echo ""

  printf "%-14s| %-8s| %-9s| %s\n" "Time" "Clients" "Rejected" "Memory"
  printf "%-14s|-%-8s|-%-9s|-%s\n" "--------------" "--------" "---------" "--------"

  while true; do
    CLIENTS=$(get_redis_clients)
    REJECTED=$(get_rejected)
    MEMORY=$(get_redis_memory)
    TIME=$(date '+%H:%M:%S')

    # Color code the client count
    if [ "$CLIENTS" -le 12 ]; then
      COLOR=$GREEN
    elif [ "$CLIENTS" -le 20 ]; then
      COLOR=$YELLOW
    else
      COLOR=$RED
    fi

    printf "%-14s| ${COLOR}%-8s${NC}| %-9s| %s\n" "$TIME" "$CLIENTS" "$REJECTED" "$MEMORY"

    sleep 10
  done
}

restart_test() {
  echo -e "${BLUE}=== Redis Leak Restart Test ===${NC}"
  echo "Restarting all app containers 10 times to simulate redeploys."
  echo "If Redis connection count climbs, there's a leak."
  echo ""

  INITIAL_CLIENTS=$(get_redis_clients)
  INITIAL_REJECTED=$(get_rejected)
  echo -e "Initial: clients=${YELLOW}$INITIAL_CLIENTS${NC}, rejected=${YELLOW}$INITIAL_REJECTED${NC}"
  echo ""

  MAX_CLIENTS=$INITIAL_CLIENTS

  for i in 1 2 3 4 5 6 7 8 9 10; do
    echo -n "Restart $i... "
    docker compose restart web worker-1 worker-2 worker-3 > /dev/null 2>&1
    sleep 8  # Wait for graceful shutdown + reconnect

    CLIENTS=$(get_redis_clients)
    REJECTED=$(get_rejected)

    # Track max
    if [ "$CLIENTS" -gt "$MAX_CLIENTS" ]; then
      MAX_CLIENTS=$CLIENTS
    fi

    # Color code
    if [ "$CLIENTS" -le 12 ]; then
      COLOR=$GREEN
    elif [ "$CLIENTS" -le 20 ]; then
      COLOR=$YELLOW
    else
      COLOR=$RED
    fi

    echo -e "clients=${COLOR}$CLIENTS${NC}, rejected=$REJECTED"
  done

  echo ""
  FINAL_CLIENTS=$(get_redis_clients)
  FINAL_REJECTED=$(get_rejected)

  echo "── Result ──"
  echo -e "Initial:   clients=$INITIAL_CLIENTS, rejected=$INITIAL_REJECTED"
  echo -e "Final:     clients=$FINAL_CLIENTS, rejected=$FINAL_REJECTED"
  echo -e "Max seen:  clients=$MAX_CLIENTS"
  echo ""

  REJECTED_DIFF=$((FINAL_REJECTED - INITIAL_REJECTED))
  CLIENTS_DIFF=$((FINAL_CLIENTS - INITIAL_CLIENTS))

  # ─── LEAK DETECTION LOGIC (corrected) ───
  # A LEAK is when:
  #   1. Client count GROWS over restarts (FINAL > INITIAL + 2 tolerance), OR
  #   2. New rejected connections appear (REJECTED_DIFF > 0)
  #
  # STABLE client count (even if "high" like 9) is NOT a leak — it means
  # the graceful shutdown is working: connections close cleanly and the
  # same count reconnects after restart.
  #
  # Typical healthy values: 5-9 clients (1 web + 3 workers + 1-2 monitor + 1 BullMQ internal)

  if [ "$REJECTED_DIFF" -gt 0 ]; then
    echo -e "${RED}✗ LEAK DETECTED${NC}"
    echo "  - $REJECTED_DIFF new rejected connections (maxclients limit hit)"
    echo "  - This means connections were NOT closed cleanly on shutdown"
    echo ""
    echo "Possible causes:"
    echo "  1. Graceful shutdown handler not registered"
    echo "  2. Worker not closing Redis connection on SIGTERM"
    echo "  3. instrumentation.ts not loading"
    exit 1
  elif [ "$CLIENTS_DIFF" -gt 2 ]; then
    echo -e "${RED}✗ LEAK DETECTED${NC}"
    echo "  - Client count grew: $INITIAL_CLIENTS → $FINAL_CLIENTS (+$CLIENTS_DIFF)"
    echo "  - Connections are accumulating across restarts"
    echo ""
    echo "Possible causes:"
    echo "  1. Graceful shutdown handler not closing Redis connections"
    echo "  2. Worker process not receiving SIGTERM"
    exit 1
  else
    echo -e "${GREEN}✓ NO LEAK DETECTED${NC}"
    echo ""
    echo "  ✓ Client count stable: $INITIAL_CLIENTS → $FINAL_CLIENTS (delta: +$CLIENTS_DIFF)"
    echo "  ✓ No new rejected connections (delta: +$REJECTED_DIFF)"
    echo "  ✓ Max clients seen during test: $MAX_CLIENTS"
    echo ""
    echo -e "${GREEN}✅ Graceful shutdown is working correctly.${NC}"
    echo "   Connections close cleanly on restart and the same count reconnects."
    exit 0
  fi
}

# ─── Main ───
case "${1:-}" in
  --watch)
    watch_mode
    ;;
  --restart-test)
    restart_test
    ;;
  *)
    check_once
    ;;
esac

#!/usr/bin/env bash

set -e
cd "$(dirname "$0")/.."
BACKENDS="8081 8082"

pids=()
cleanup() {
  for pid in "${pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

for port in $BACKENDS; do
  PORT=$port go run ./cmd/server &
  pid=$!
  pids+=($pid)
  echo "backend on :$port (PID $pid)"
done

NGINX_CONF="$(pwd)/nginx/skepsi.conf"
echo ""
echo "Backends running. Start nginx (e.g.):"
echo "  nginx -c $NGINX_CONF"
echo "Then connect clients to ws://localhost:8080/ws"
echo ""
wait

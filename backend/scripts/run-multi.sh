#!/usr/bin/env bash
# Run two backend servers and the doc-routing proxy for local multi-server testing.
# Clients should connect to the proxy (default port 8080).
# Usage: from repo root, ./backend/scripts/run-multi.sh   or from backend: ./scripts/run-multi.sh

set -e
cd "$(dirname "$0")/.."
BACKENDS="8081 8082"
PROXY_PORT="${PORT:-8080}"

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

sleep 1
WS_BACKENDS="http://localhost:8081,http://localhost:8082" PORT="$PROXY_PORT" go run ./cmd/proxy &
pid=$!
pids+=($pid)
echo "proxy on :$PROXY_PORT (PID $pid)"
echo "Connect clients to ws://localhost:$PROXY_PORT/ws"
wait

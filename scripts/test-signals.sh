#!/usr/bin/env bash
# Verify SIGTERM quits the app and does not orphan the dsh host.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

tmp="$(mktemp -d)"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

export DSH_HOME="$tmp/home"
export DSH_LINUX_APP_STATE_DIR="$tmp/state"
export DSH_LINUX_APP_CONFIG_DIR="$tmp/config"
export DSH_LINUX_APP_USER_DATA="$tmp/user-data"
mkdir -p "$DSH_HOME" "$DSH_LINUX_APP_STATE_DIR" "$DSH_LINUX_APP_CONFIG_DIR" "$DSH_LINUX_APP_USER_DATA"

out="$tmp/out"
./node_modules/electron/dist/electron . >"$out" 2>&1 &
app_pid=$!

fail() {
  echo "signals: FAIL: $1" >&2
  kill -9 "$app_pid" 2>/dev/null || true
  exit 1
}

for _ in $(seq 1 120); do
  grep -q 'HOST_PID=' "$out" 2>/dev/null && break
  sleep 0.5
done
host_pid="$(grep -o 'HOST_PID=[0-9]*' "$out" | tail -n 1 | cut -d= -f2)"
[[ -n "$host_pid" ]] || fail "the app never reported a host pid"

kill -TERM "$app_pid"
for _ in $(seq 1 40); do
  kill -0 "$app_pid" 2>/dev/null || break
  sleep 0.25
done
kill -0 "$app_pid" 2>/dev/null && fail "the app survived SIGTERM"

sleep 1
kill -0 "$host_pid" 2>/dev/null && fail "host $host_pid was orphaned by SIGTERM"

grep -q 'SIGTERM received' "$DSH_LINUX_APP_STATE_DIR/app.log" || fail "the signal handler did not run"
grep -qi 'host stopped' "$DSH_LINUX_APP_STATE_DIR/host.log" || fail "host log has no stop record"

echo "signals: PASS (SIGTERM stopped the app and host $host_pid)"

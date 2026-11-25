#!/usr/bin/env bash
# Verify --hidden: the app starts in the tray without showing its window.
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
export DSH_LINUX_APP_AUTOQUIT_MS=3500
mkdir -p "$DSH_HOME" "$DSH_LINUX_APP_STATE_DIR" "$DSH_LINUX_APP_CONFIG_DIR" "$DSH_LINUX_APP_USER_DATA"

out="$tmp/out"
set +e
timeout 120 ./node_modules/electron/dist/electron . --hidden >"$out" 2>&1
status=$?
set -e

echo "----- app output -----"
cat "$out"
echo "----------------------"

fail() { echo "hidden: FAIL: $1" >&2; exit 1; }

grep -q 'hidden=true' "$tmp/state/app.log" || fail "--hidden was not detected"
grep -q 'app: started hidden (--hidden)' "$tmp/state/app.log" || fail "the app did not enter the hidden state"
grep -q 'window: loaded visible=false' "$tmp/state/app.log" || fail "the window became visible"
grep -q 'window: autoquit visible=false' "$tmp/state/app.log" || fail "the window was visible at autoquit"
grep -q 'dsh web: http' "$tmp/state/host.log" || fail "the host did not start"
grep -q 'host stopped' "$tmp/state/host.log" || fail "the host did not stop on quit"
[[ "$status" -eq 0 ]] || fail "app exited with $status"

echo "hidden: PASS (window stayed hidden, host started and stopped)"

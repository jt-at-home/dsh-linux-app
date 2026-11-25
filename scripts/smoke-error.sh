#!/usr/bin/env bash
# Error-path smoke test: force a host failure and check the in-window error page.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

tmp="$(mktemp -d)"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

export DSH_LINUX_APP_SMOKE=1
export DSH_LINUX_APP_SMOKE_ERROR=1
export DSH_LINUX_APP_DSH="$tmp/does-not-exist"
export DSH_HOME="$tmp/home"
export DSH_LINUX_APP_STATE_DIR="$tmp/state"
export DSH_LINUX_APP_CONFIG_DIR="$tmp/config"
export DSH_LINUX_APP_USER_DATA="$tmp/user-data"
mkdir -p "$DSH_HOME" "$DSH_LINUX_APP_STATE_DIR" "$DSH_LINUX_APP_CONFIG_DIR" "$DSH_LINUX_APP_USER_DATA"

out="$tmp/app.out"
set +e
timeout 120 ./node_modules/.bin/electron . >"$out" 2>&1
status=$?
set -e

echo "----- app output -----"
cat "$out"
echo "----------------------"

fail() { echo "smoke-error: FAIL: $1" >&2; exit 1; }

grep -q 'SMOKE: error-page' "$out" || fail "no error page was reported"
grep -q 'retry=true' "$out" || fail "error page has no Retry action"
grep -q 'could not start' "$out" || fail "startup failure was not logged"
[[ "$status" -eq 0 ]] || fail "app exited with $status"

echo "smoke-error: PASS (error page shown with Retry)"

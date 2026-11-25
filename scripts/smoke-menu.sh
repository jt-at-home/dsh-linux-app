#!/usr/bin/env bash
# Verify the in-window menu button opens the real native popup menu.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

tmp="$(mktemp -d)"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

export DSH_LINUX_APP_SMOKE=1
export DSH_LINUX_APP_SMOKE_SHOW=1
export DSH_LINUX_APP_SMOKE_MENU=1
export DSH_HOME="$tmp/home"
export DSH_LINUX_APP_STATE_DIR="$tmp/state"
export DSH_LINUX_APP_CONFIG_DIR="$tmp/config"
export DSH_LINUX_APP_USER_DATA="$tmp/user-data"
mkdir -p "$DSH_HOME" "$DSH_LINUX_APP_STATE_DIR" "$DSH_LINUX_APP_CONFIG_DIR" "$DSH_LINUX_APP_USER_DATA"

out="$tmp/out"
set +e
timeout 180 ./node_modules/.bin/electron . >"$out" 2>&1
status=$?
set -e

echo "----- app output -----"
cat "$out"
echo "----------------------"

fail() { echo "smoke-menu: FAIL: $1" >&2; exit 1; }

grep -q 'SMOKE: app-button=true' "$out" || fail "the app-menu button is missing"
grep -q 'SMOKE: menu-popup=opened' "$out" || fail "the popup menu did not open"
grep -q 'SMOKE: menu-closed' "$out" || fail "the popup menu did not close"
grep -q 'app menu failed' "$out" && fail "popup reported a failure"
[[ "$status" -eq 0 ]] || fail "app exited with $status"

echo "smoke-menu: PASS (button opened and closed the native popup)"

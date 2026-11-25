#!/usr/bin/env bash
# Simulate a desktop-entry launch: no nvm directory on PATH, only the distro
# Node (18 here). The app must pair dsh with its own Node instead of silently
# failing with an incompatible interpreter.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

tmp="$(mktemp -d)"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

mkdir -p "$tmp/home" "$tmp/state" "$tmp/config" "$tmp/user-data"

out="$tmp/out"
env -u DSH_LINUX_APP_DSH -u DSH_LINUX_APP_NODE \
  PATH=/usr/bin:/bin \
  DSH_HOME="$tmp/home" \
  DSH_LINUX_APP_STATE_DIR="$tmp/state" \
  DSH_LINUX_APP_CONFIG_DIR="$tmp/config" \
  DSH_LINUX_APP_USER_DATA="$tmp/user-data" \
  DSH_LINUX_APP_AUTOQUIT_MS=3000 \
  timeout 120 ./node_modules/electron/dist/electron . >"$out" 2>&1 || true

echo "----- app output -----"
cat "$out"
echo "----------------------"

fail() { echo "env: FAIL: $1" >&2; exit 1; }

grep -q 'host: launching' "$tmp/state/app.log" || fail "the host was never launched"
launch="$(grep -m1 'host: launching' "$tmp/state/app.log")"
node_bin="$(awk '{print $4}' <<<"$launch")"
dsh_script="$(awk '{print $5}' <<<"$launch")"
[[ -x "$node_bin" ]] || fail "the resolved Node is not executable: $node_bin"
prefix="$(dirname "$(dirname "$node_bin")")"
case "$dsh_script" in
  "$prefix"/lib/node_modules/@deepseek-ai/dsh/*) ;;
  *) fail "dsh was not paired with the Node beside it: $launch" ;;
esac
grep -q 'dsh web: http' "$tmp/state/host.log" || fail "the host never reported its URL"
grep -q 'window: autoquit visible=true' "$tmp/state/app.log" || fail "the window did not become visible"
grep -q 'boot failed' "$tmp/state/app.log" && fail "startup failed"

echo "env: PASS (desktop-like PATH paired dsh with its own Node and the UI loaded)"

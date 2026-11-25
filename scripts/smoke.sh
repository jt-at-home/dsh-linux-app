#!/usr/bin/env bash
# Smoke test: isolated profile/config, render assertion, close-to-tray, zoom
# persistence, and host teardown.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

if [[ ! -x node_modules/.bin/electron ]]; then
  echo "smoke: electron is not installed; run: npm install" >&2
  exit 1
fi

tmp="$(mktemp -d)"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

export DSH_LINUX_APP_SMOKE=1
export DSH_LINUX_APP_TRAY_HOST=1
export DSH_HOME="$tmp/home"
export DSH_LINUX_APP_STATE_DIR="$tmp/state"
export DSH_LINUX_APP_CONFIG_DIR="$tmp/config"
export DSH_LINUX_APP_USER_DATA="$tmp/user-data"
mkdir -p "$DSH_HOME" "$DSH_LINUX_APP_STATE_DIR" "$DSH_LINUX_APP_CONFIG_DIR" "$DSH_LINUX_APP_USER_DATA"

out="$tmp/app.out"
run() {
  set +e
  timeout 300 ./node_modules/.bin/electron . >"$out" 2>&1
  local status=$?
  set -e
  return "$status"
}

echo "smoke: starting app"
if ! run; then
  if grep -qiE 'sandbox|SUID' "$out"; then
    echo "smoke: sandbox unavailable, retrying with --no-sandbox"
    export DSH_LINUX_APP_NO_SANDBOX=1
    run || true
  fi
fi

echo "----- app output -----"
cat "$out"
echo "----------------------"

fail() { echo "smoke: FAIL: $1" >&2; exit 1; }

grep -q 'SMOKE: page loaded' "$out" || fail "the window never reported a loaded page"
grep -q 'title="DeepSeek Harness"' "$out" || fail "unexpected page title"
grep -q 'readyState=complete' "$out" || fail "page did not finish loading"
grep -qE 'rootChildren=[1-9]' "$out" || fail "the Web UI did not mount (#root is empty)"
grep -q 'SMOKE: menubar=false' "$out" || fail "menu bar should stay hidden"
grep -q 'SMOKE: app-button=true' "$out" || fail "the in-window app-menu button is missing"
grep -q 'SMOKE: app-menu-ipc=true' "$out" || fail "the app-menu button did not reach the main process"
grep -q 'SMOKE: context-menu-emitted' "$out" || fail "context menu was not exercised"
grep -q 'SMOKE: context-menu items=.*labels=Undo|Redo|Cut|Copy|Paste|Select All' "$out" || fail "context menu labels are wrong"
grep -q 'SMOKE: zoom=1.25' "$out" || fail "zoom action did not run"
grep -q 'SMOKE: hidden-to-tray=true' "$out" || fail "closing the window did not hide it"

grep -q '"zoom": 1.25' "$DSH_LINUX_APP_CONFIG_DIR/config.json" || fail "zoom was not persisted to config.json"

node -e '
const fs = require("node:fs")
const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
if (config.window.x === null || config.window.y === null) { console.error("window position missing"); process.exit(1) }
if (config.window.width < 900 || config.window.height < 500) { console.error(`unexpected bounds ${config.window.width}x${config.window.height}`); process.exit(1) }
' "$DSH_LINUX_APP_CONFIG_DIR/config.json" || fail "window bounds were not persisted"

pid="$(grep -o 'HOST_PID=[0-9]*' "$out" | tail -n 1 | cut -d= -f2)"
[[ -n "$pid" ]] || fail "the app never reported a host pid"

sleep 1
if kill -0 "$pid" 2>/dev/null; then
  fail "host process $pid is still running after app exit"
fi

grep -qi 'host stopped' "$DSH_LINUX_APP_STATE_DIR/host.log" 2>/dev/null || fail "host log has no stop record"
grep -qi 'tray:' "$DSH_LINUX_APP_STATE_DIR/app.log" 2>/dev/null || fail "tray creation was not attempted"

echo "smoke: PASS (page rendered, zoom persisted, close hid the window, host pid $pid exited)"

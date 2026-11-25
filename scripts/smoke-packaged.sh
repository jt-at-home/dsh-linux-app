#!/usr/bin/env bash
# Smoke-test a packaged build: the unpacked directory or an AppImage.
#
#   scripts/smoke-packaged.sh                     # prefer dist/linux-unpacked, else the AppImage
#   scripts/smoke-packaged.sh <path-to-binary>    # explicit
#
# Runs the packaged app with --hidden, an isolated home and an auto-quit, then
# checks that the host started and stopped and that no window was ever shown.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

tmp="$(mktemp -d)"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

candidate="${1:-}"
is_appimage=0
if [[ -z "$candidate" ]]; then
  if [[ -x dist/linux-unpacked/dsh-linux-app ]]; then
    candidate=dist/linux-unpacked/dsh-linux-app
  else
    shopt -s nullglob
    images=(dist/*.AppImage)
    shopt -u nullglob
    if (( ${#images[@]} == 0 )); then
      echo "smoke-packaged: no build found; run 'npm run package:dir' or 'npm run package'" >&2
      exit 1
    fi
    candidate="${images[0]}"
    is_appimage=1
  fi
fi
if [[ "$candidate" == *.deb ]]; then
  # Regression: the supervisor is run by the system Node, so it must not be
  # packaged as root-only 0600 (that fails with EACCES after installation).
  deb_listing="$(dpkg-deb -c "$candidate")"
  supervisor_mode="$(awk '/host-supervisor\.mjs/ {print $1; exit}' <<<"$deb_listing")"
  [[ -n "$supervisor_mode" ]] || { echo "smoke-packaged: FAIL: no supervisor in the deb" >&2; exit 1; }
  case "$supervisor_mode" in
    -rw-r--r--*) ;;
    *) echo "smoke-packaged: FAIL: supervisor in the deb is '$supervisor_mode' (needs to be world-readable)" >&2; exit 1 ;;
  esac
  dpkg-deb -x "$candidate" "$tmp/deb" || { echo "smoke-packaged: cannot extract $candidate" >&2; exit 1; }
  candidate="$(find "$tmp/deb" -path '*/opt/*/dsh-linux-app' -type f | head -n 1)"
  [[ -n "$candidate" ]] || { echo "smoke-packaged: no binary in the .deb" >&2; exit 1; }
fi
[[ -x "$candidate" ]] || { echo "smoke-packaged: not executable: $candidate" >&2; exit 1; }
[[ "$candidate" == *.AppImage ]] && is_appimage=1

echo "smoke-packaged: testing $candidate"
mkdir -p "$tmp/home" "$tmp/state" "$tmp/config" "$tmp/user-data"

export DSH_HOME="$tmp/home"
export DSH_LINUX_APP_STATE_DIR="$tmp/state"
export DSH_LINUX_APP_CONFIG_DIR="$tmp/config"
export DSH_LINUX_APP_USER_DATA="$tmp/user-data"
export DSH_LINUX_APP_AUTOQUIT_MS=5000

out="$tmp/out"
run() {
  local extra=()
  [[ "$is_appimage" -eq 1 ]] && extra+=(APPIMAGE_EXTRACT_AND_RUN=1)
  set +e
  env "${extra[@]}" timeout 300 "$candidate" --hidden >"$out" 2>&1
  local status=$?
  set -e
  return "$status"
}

if ! run; then
  if grep -qiE 'sandbox|SUID|namespace' "$out"; then
    echo "smoke-packaged: sandbox unavailable, retrying with --no-sandbox"
    set +e
    APPIMAGE_EXTRACT_AND_RUN=1 timeout 300 "$candidate" --hidden --no-sandbox >"$out" 2>&1
    set -e
  fi
fi

echo "----- app output -----"
cat "$out"
echo "----------------------"

fail() { echo "smoke-packaged: FAIL: $1" >&2; exit 1; }

grep -q 'hidden=true' "$tmp/state/app.log" || fail "--hidden was not detected"
grep -q 'app: started hidden (--hidden)' "$tmp/state/app.log" || fail "the packaged app did not stay hidden"
grep -q 'window: autoquit visible=false' "$tmp/state/app.log" || fail "the window became visible"
grep -q 'dsh web: http' "$tmp/state/host.log" || fail "the packaged host did not start"
grep -q 'host stopped' "$tmp/state/host.log" || fail "the packaged host did not stop"
grep -q 'boot failed' "$tmp/state/app.log" && fail "the packaged app reported a boot failure"
grep -q 'tray: unavailable' "$tmp/state/app.log" && echo "smoke-packaged: warning: no tray host (hidden start fell back)"

echo "smoke-packaged: PASS (packaged app started hidden, host round-tripped)"

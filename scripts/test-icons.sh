#!/usr/bin/env bash
# Check the generated icons: transparent background, expected sizes and colours.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

fail() { echo "icons: FAIL: $1" >&2; exit 1; }

for file in assets/icon.png assets/tray-light.png assets/tray-dark.png; do
  [[ -f "$file" ]] || fail "missing $file"
  identify "$file" >/dev/null 2>&1 || fail "$file is not a readable image"
done

[[ "$(identify -format '%wx%h' assets/icon.png)" == "1024x1024" ]] || fail "app icon should be 1024x1024"
[[ "$(identify -format '%wx%h' assets/tray-light.png)" == "64x64" ]] || fail "tray-light should be 64x64"
[[ "$(identify -format '%wx%h' assets/tray-dark.png)" == "64x64" ]] || fail "tray-dark should be 64x64"

# Transparent corners: no opaque square behind the mark.
for file in assets/icon.png assets/tray-light.png assets/tray-dark.png; do
  corner="$(convert "$file" -format '%[pixel:p{0,0}]' info:)"
  case "$corner" in
    *',0)' | *'alpha 0'*) ;;
    *) fail "$file has a non-transparent corner: $corner" ;;
  esac
done

# Colour variants: blue app icon, white and near-black tray marks.
# Capture the histogram first: `convert | grep -q` can lose the race against
# SIGPIPE, which pipefail would turn into a failure even on a match.
has_colour() {
  local file=$1 colour=$2 histogram
  histogram="$(convert "$file" -format %c histogram:info:-)"
  grep -qi "$colour" <<<"$histogram"
}

has_colour assets/icon.png '4D6BFE' || fail "app icon is not DeepSeek blue"
has_colour assets/tray-light.png 'FFFFFF' || fail "tray-light is not white"
has_colour assets/tray-dark.png '1B1C1F' || fail "tray-dark is not near-black"

echo "icons: PASS (transparent 1024 app icon, white/near-black 64px tray variants)"

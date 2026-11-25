#!/usr/bin/env bash
# Regenerate the PNG icons from the whale mark (assets/whale.svg).
#
#   assets/icon.png        app icon, DeepSeek blue, transparent, 1024x1024
#   assets/tray-light.png  tray variant for dark panels (white), 64x64
#   assets/tray-dark.png   tray variant for light panels (near-black), 64x64
#
# Requires ImageMagick (`convert`). Run from anywhere; paths are repo-relative.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

command -v convert >/dev/null 2>&1 || { echo "make-icons: ImageMagick 'convert' is required" >&2; exit 1; }

tmp="$(mktemp -d)"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

recolor() {
  local color=$1 out=$2
  sed "s/fill=\"#000\"/fill=\"$color\"/" assets/whale.svg >"$out"
}

recolor '#4D6BFE' "$tmp/blue.svg"
recolor '#FFFFFF' "$tmp/white.svg"
recolor '#1B1C1F' "$tmp/dark.svg"

# render <svg> <canvas> <content> <output>
render() {
  local svg=$1 canvas=$2 content=$3 out=$4
  convert -background none -density 2400 "$svg" \
    -resize "${canvas}x${canvas}" -trim +repage \
    -resize "${content}x${content}" -gravity center -background none -extent "${canvas}x${canvas}" \
    "PNG32:$out"
  echo "wrote $out"
}

render "$tmp/blue.svg" 1024 848 assets/icon.png
render "$tmp/white.svg" 64 56 assets/tray-light.png
render "$tmp/dark.svg" 64 56 assets/tray-dark.png

# Packaging icon set for electron-builder (hicolor sizes).
mkdir -p build/icons
for size in 16 24 32 48 64 128 256 512 1024; do
  convert assets/icon.png -resize "${size}x${size}" "PNG32:build/icons/${size}x${size}.png"
done
echo "wrote build/icons (16…1024)"

identify -format '%f %wx%h %[channels]\n' assets/icon.png assets/tray-light.png assets/tray-dark.png

#!/usr/bin/env bash
# Install a desktop entry and a launcher symlink into the user's XDG dirs.
#   scripts/install-desktop.sh           install
#   scripts/install-desktop.sh --remove  remove the entry and symlink
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
desktop_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
bin_dir="$HOME/.local/bin"
desktop_file="$desktop_dir/dsh-linux-app.desktop"
launcher="$bin_dir/dsh-linux-app"

if [[ "${1:-}" == "--remove" ]]; then
  rm -f "$desktop_file" "$launcher"
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$desktop_dir" 2>/dev/null || true
  echo "removed $desktop_file and $launcher"
  exit 0
fi

if [[ ! -x "$root/node_modules/.bin/electron" ]]; then
  echo "install-desktop: run 'npm install' in $root first" >&2
  exit 1
fi

chmod +x "$root/bin/dsh-linux-app"
mkdir -p "$desktop_dir" "$bin_dir"
ln -sfn "$root/bin/dsh-linux-app" "$launcher"

cat >"$desktop_file" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=DeepSeek Harness
Comment=DeepSeek Harness Web UI in a dedicated window
Exec=$launcher
TryExec=$launcher
Icon=$root/assets/icon.png
Terminal=false
StartupWMClass=deepseek-harness
StartupNotify=true
Categories=Development;Utility;
EOF

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$desktop_dir" 2>/dev/null || true

echo "installed:"
echo "  launcher: $launcher"
echo "  entry:    $desktop_file"
echo "If the icon does not appear immediately, log out and back in or run: update-desktop-database $desktop_dir"

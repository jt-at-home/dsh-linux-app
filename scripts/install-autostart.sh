#!/usr/bin/env bash
# Install (or remove) an XDG login autostart entry that launches the app hidden
# in the tray.
#
#   scripts/install-autostart.sh           install
#   scripts/install-autostart.sh --remove  remove
#
# Requires the desktop launcher from scripts/install-desktop.sh.
set -euo pipefail

entry_dir="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
entry="$entry_dir/dsh-linux-app.desktop"

case "${1:-}" in
  --remove)
    rm -f "$entry"
    echo "removed $entry"
    exit 0
    ;;
  '') ;;
  *)
    echo "usage: $0 [--remove]" >&2
    exit 2
    ;;
esac

launcher="${DSH_LINUX_APP_LAUNCHER:-}"
if [[ -z "$launcher" ]]; then
  for candidate in "$HOME/.local/bin/dsh-linux-app" /usr/bin/dsh-linux-app "/opt/DeepSeek Harness/dsh-linux-app"; do
    if [[ -x "$candidate" ]]; then launcher="$candidate"; break; fi
  done
fi
if [[ -z "$launcher" ]]; then
  echo "install-autostart: no launcher found; install the desktop entry or the package," >&2
  echo "or set DSH_LINUX_APP_LAUNCHER to the AppImage/binary path" >&2
  exit 1
fi
if [[ ! -x "$launcher" ]]; then
  echo "install-autostart: not executable: $launcher" >&2
  exit 1
fi

mkdir -p "$entry_dir"
cat >"$entry" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=DeepSeek Harness
Comment=Start DeepSeek Harness hidden in the tray
Exec="$launcher" --hidden
Terminal=false
StartupNotify=false
X-GNOME-Autostart-enabled=true
Hidden=false
EOF

echo "installed: $entry (launcher: $launcher)"
echo "The harness will start in the tray at your next login."

#!/usr/bin/env bash
set -euo pipefail
# Run after extracting the portable app to its permanent location; no sudo.
app_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
[[ "$app_dir" != *$'\n'* && "$app_dir" != *$'\r'* ]] || { echo 'Unsupported application path.' >&2; exit 1; }
app_exec="${app_dir}/OCLR IRC"
[[ -x "$app_exec" ]] || { echo 'OCLR IRC executable is missing.' >&2; exit 1; }
[[ -f "${app_dir}/oclr-irc.png" ]] || { echo 'OCLR IRC icon is missing.' >&2; exit 1; }
command -v xdg-mime >/dev/null || { echo 'Install xdg-utils first.' >&2; exit 1; }
# Escape Desktop Entry Exec quoted arguments, including literal percent signs.
escaped="${app_exec//\\/\\\\}"
escaped="${escaped//\"/\\\"}"
escaped="${escaped//\$/\\\$}"
escaped="${escaped//\`/\\\`}"
escaped="${escaped//%/%%}"
desktop_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
icon_dir="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/256x256/apps"
mkdir -p -- "$desktop_dir"
mkdir -p -- "$icon_dir"
cp -- "${app_dir}/oclr-irc.png" "$icon_dir/oclr-irc.png"
cat > "$desktop_dir/oclr-irc.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=OCLR IRC
Icon=oclr-irc
Exec="${escaped}" %u
Terminal=false
Categories=Network;Chat;
MimeType=x-scheme-handler/oclr-irc;
DESKTOP
xdg-mime default oclr-irc.desktop x-scheme-handler/oclr-irc

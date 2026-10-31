#!/usr/bin/env bash
set -euo pipefail
# Run after extracting the portable app to its permanent location; no sudo.
app_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
[[ "$app_dir" != *$'\n'* && "$app_dir" != *$'\r'* ]] || { echo 'Unsupported application path.' >&2; exit 1; }
app_exec="${app_dir}/OCLR IRC"
[[ -x "$app_exec" ]] || { echo 'OCLR IRC executable is missing.' >&2; exit 1; }
command -v xdg-mime >/dev/null || { echo 'Install xdg-utils first.' >&2; exit 1; }
# Escape Desktop Entry Exec quoted arguments, including literal percent signs.
escaped="${app_exec//\\/\\\\}"
escaped="${escaped//\"/\\\"}"
escaped="${escaped//\$/\\\$}"
escaped="${escaped//\`/\\\`}"
escaped="${escaped//%/%%}"
desktop_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p -- "$desktop_dir"
cat > "$desktop_dir/oclr-irc.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=OCLR IRC
Exec="${escaped}" %u
Terminal=false
Categories=Network;Chat;
MimeType=x-scheme-handler/oclr-irc;
DESKTOP
xdg-mime default oclr-irc.desktop x-scheme-handler/oclr-irc

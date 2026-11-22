#!/bin/sh
# Installs the weekly SPAR refresh on this Mac (Sundays 03:30; if the Mac was asleep, it runs when it wakes).
# Usage, from the repo folder: sh scripts/mac/install.sh      Remove: sh scripts/mac/install.sh --remove
set -e
LABEL=dev.cpsaul.marychef-precios.spar
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
if [ "$1" = "--remove" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"; echo "Removed."; exit 0
fi
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "Node is not installed (brew install node)"; exit 1; }
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>$REPO/scripts/update-spar.sh</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>StartCalendarInterval</key><dict><key>Weekday</key><integer>0</integer><key>Hour</key><integer>3</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/marychef-spar.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/marychef-spar.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed. Log: ~/Library/Logs/marychef-spar.log  Run now: launchctl kickstart gui/$(id -u)/$LABEL"

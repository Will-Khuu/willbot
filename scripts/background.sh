#!/bin/zsh
# Runs will-bot as a macOS login item (a LaunchAgent): it starts when you log
# in, restarts if it crashes, and serves http://127.0.0.1:3000.
set -euo pipefail

LABEL="com.willbot.app"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$HOME/Library/Logs/will-bot.log"
DOMAIN="gui/$(id -u)"

# Next runs as the job's own process (not under npm), so when it dies launchd
# sees the exit and KeepAlive restarts it.
write_plist() {
  mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>cd "$ROOT" &amp;&amp; exec ./node_modules/.bin/next start -H 127.0.0.1 -p 3000</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
}

# The notification helper needs Xcode's command line tools; without them
# notifications still show, but a click cannot open will-bot.
build_notifier() {
  "$ROOT/scripts/notifier/build.sh" >/dev/null || echo "Could not build the notification helper; notifications will not open will-bot when clicked." >&2
}

port_busy() {
  lsof -ti tcp:3000 -sTCP:LISTEN >/dev/null 2>&1
}

case "${1:-}" in
  install)
    if port_busy && ! launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      echo "Port 3000 is in use. Stop the other will-bot (npm run dev) first." >&2
      exit 1
    fi
    (cd "$ROOT" && npm run build)
    build_notifier
    write_plist
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    # launchd finishes tearing down the old job asynchronously; bootstrapping
    # before then fails with "Input/output error".
    for _ in {1..20}; do
      launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || break
      sleep 0.5
    done
    for attempt in {1..5}; do
      launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null && break
      [ "$attempt" = 5 ] && { echo "Could not start the login item; see: npm run background -- logs" >&2; exit 1; }
      sleep 2
    done
    echo "will-bot is running in the background at http://127.0.0.1:3000 and will start at login."
    ;;
  restart)
    (cd "$ROOT" && npm run build)
    build_notifier
    launchctl kickstart -k "$DOMAIN/$LABEL"
    echo "Rebuilt and restarted will-bot."
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "will-bot no longer runs in the background."
    ;;
  status)
    if launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -E "state =|pid =" ; then :; else echo "Not installed."; fi
    ;;
  logs)
    tail -n "${2:-50}" "$LOG"
    ;;
  *)
    echo "Usage: npm run background -- install | restart | uninstall | status | logs [lines]" >&2
    exit 2
    ;;
esac

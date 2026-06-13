#!/usr/bin/env bash
#
# Executable acceptance-criteria check for the theme toggle feature.
# Translates the spec (docs/superpowers/specs/2026-06-13-theme-toggle-design.md)
# into checks that exit 0 iff every gating criterion passes.
#
# Gating criteria (machine-checkable):
#   C1  device-light + no saved choice -> light theme, sun icon, aria-pressed=false
#   C2  device-dark + no saved choice -> dark theme, moon icon, aria-pressed=true
#   C3  tap toggle -> theme flips, icon updates, localStorage.theme set to opposite
#   C4  reload with saved choice -> correct theme applied; no-flash inline script before stylesheet
#   C5  cross-page: saved choice persists on both index.html and arhiva.html
#   C6  clear localStorage.theme -> follows device
#   C7  error/loading state (missing latest.json) -> toggle still present in topbar
#   C8  stale value (localStorage.theme='auto') -> ignored, follows device
#   +   idempotency: double mountToggle leaves exactly one button
#   +   structural: arhiva toggle is inside .meta, not #app
#
# Non-gating (requires live OS theme flip, not automatable headlessly):
#   C9  live OS flip with no saved choice -> icon tracks OS change
#
# Self-contained: starts and stops a python3 HTTP server from site/.
# Requires: python3 (stdlib), Node 20+, Playwright globally installed.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PORT=18765
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Start local HTTP server from site/
python3 -m http.server "$PORT" --directory "$ROOT/site" >/dev/null 2>&1 &
SERVER_PID=$!

# Wait for server to be ready (up to 4 seconds)
for i in $(seq 1 20); do
  if curl -sf "http://localhost:$PORT/" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

if ! curl -sf "http://localhost:$PORT/" >/dev/null 2>&1; then
  echo "FATAL: local server on port $PORT did not start"
  exit 1
fi

echo "Server running at http://localhost:$PORT"

# Run all browser checks (exits 0 iff all pass)
exec node "$SCRIPT_DIR/scenario-browser.mjs" "http://localhost:$PORT"

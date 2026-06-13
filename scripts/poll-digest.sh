#!/usr/bin/env bash
# Local backup poller for the nightly digest.
#
# GitHub frequently drops scheduled (cron) workflow runs, which can leave a
# finished night un-published for hours. This script runs from a local launchd
# agent every 15 minutes and triggers the digest workflow during the night
# window. The workflow itself runs with --require-complete, so any trigger
# before every match has finished is a cheap no-op.
set -euo pipefail

REPO="mcandea04/mondial"
GH="/opt/homebrew/bin/gh"
LOG="${HOME}/Library/Logs/mondial-poll.log"

log() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') $*" >> "$LOG"; }

# Active hours in UTC. No night ever finishes before midnight EEST (= 21:00 UTC),
# since the readiness gate needs every match FINISHED, so polling earlier than
# 21:00 UTC can never publish -- start there (00:00 EEST). The window's last
# kickoff is < 06:00 UTC, but a match kicking off near 06:00 can play extra time
# + penalties and the API only flips it to FINISHED afterwards, so finishes (and
# the API lag behind them) can land at 08:00-09:00 UTC; poll through 10:00 UTC to
# cover that tail. Active: 21:00 UTC through 10:00 UTC. Dead zone: UTC 11-20.
# Over-polling is safe: run.js freezes prose on an unchanged factsHash and never
# overwrites a newer digest, so extra triggers are cheap no-ops.
hour_utc=$(date -u +%-H)
if (( hour_utc >= 11 && hour_utc <= 20 )); then
  log "skip: outside night window (UTC hour ${hour_utc})"
  exit 0
fi

if "$GH" workflow run digest.yml --repo "$REPO" >/dev/null 2>&1; then
  log "triggered digest.yml (UTC hour ${hour_utc})"
else
  log "ERROR: failed to trigger digest.yml (UTC hour ${hour_utc})"
  exit 1
fi

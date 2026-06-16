#!/usr/bin/env bash
# Acceptance scenario for ESPN sole-source design (#22 fix).
# Verifies each machine-checkable criterion from the spec.
# Exits 0 iff every criterion passes.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0

ok()   { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

# ── C1: fetch.js and enrich.js are deleted ────────────────────────────────────
if [ ! -f "$REPO/pipeline/fetch.js" ]; then
  ok "pipeline/fetch.js deleted"
else
  fail "pipeline/fetch.js still exists"
fi

if [ ! -f "$REPO/pipeline/enrich.js" ]; then
  ok "pipeline/enrich.js deleted"
else
  fail "pipeline/enrich.js still exists"
fi

# ── C2: espn.js exists and exports the required functions ─────────────────────
if [ -f "$REPO/pipeline/espn.js" ]; then
  ok "pipeline/espn.js exists"
else
  fail "pipeline/espn.js missing"
fi

if grep -q "export const isOver" "$REPO/pipeline/espn.js"; then
  ok "isOver exported from espn.js"
else
  fail "isOver not exported from espn.js"
fi

if grep -q "export async function fetchDigestData" "$REPO/pipeline/espn.js"; then
  ok "fetchDigestData exported from espn.js"
else
  fail "fetchDigestData not exported from espn.js"
fi

if grep -q "export async function fetchNightMatches" "$REPO/pipeline/espn.js"; then
  ok "fetchNightMatches exported from espn.js"
else
  fail "fetchNightMatches not exported from espn.js"
fi

# ── C3: run.js imports from espn.js, not fetch.js ─────────────────────────────
if grep -q "from './espn.js'" "$REPO/pipeline/run.js"; then
  ok "run.js imports from espn.js"
else
  fail "run.js does not import from espn.js"
fi

if ! grep -q "from './fetch.js'" "$REPO/pipeline/run.js"; then
  ok "run.js does not import from fetch.js"
else
  fail "run.js still imports from fetch.js"
fi

# ── C4: FOOTBALL_DATA_TOKEN removed from digest.yml ──────────────────────────
if ! grep -q "FOOTBALL_DATA_TOKEN" "$REPO/.github/workflows/digest.yml"; then
  ok "FOOTBALL_DATA_TOKEN removed from digest.yml"
else
  fail "FOOTBALL_DATA_TOKEN still in digest.yml"
fi

# ── C5: mergeStats exported from run.js ──────────────────────────────────────
if grep -q "export function mergeStats" "$REPO/pipeline/run.js"; then
  ok "mergeStats exported from run.js"
else
  fail "mergeStats not exported from run.js"
fi

# ── C6: mergeEnrichment does NOT have a stats: assignment in return object ────
# Extract mergeEnrichment body and check the return statement does not assign stats:
STATS_IN_MERGE=$(node --input-type=module <<JSEOF
import { readFileSync } from 'node:fs';
const content = readFileSync('$REPO/pipeline/run.js', 'utf8');
const fnMatch = content.match(/export function mergeEnrichment[\s\S]*?\n\}/);
if (!fnMatch) { console.log('NOT_FOUND'); process.exit(0); }
const fn = fnMatch[0];
// Check if the return object has stats: as a property assignment
const hasStats = /return\s*\{[\s\S]*?^\s+stats\s*:/m.test(fn);
console.log(hasStats ? 'HAS_STATS' : 'NO_STATS');
JSEOF
)

if [ "$STATS_IN_MERGE" = "NO_STATS" ]; then
  ok "mergeEnrichment return object does not contain stats:"
else
  fail "mergeEnrichment return object still contains stats: (got: $STATS_IN_MERGE)"
fi

# ── C7: isOver is the single completion predicate (used consistently) ─────────
# Both fetchNightMatches and fetchDigestData use isOver for filtering finished
ISOVER_USES=$(grep -c "isOver" "$REPO/pipeline/espn.js" || true)
if [ "$ISOVER_USES" -ge 2 ]; then
  ok "isOver used in multiple places in espn.js (gate + build)"
else
  fail "isOver only used $ISOVER_USES times in espn.js, expected >= 2"
fi

# ── C8: full test suite passes ────────────────────────────────────────────────
echo ""
echo "Running npm test..."
cd "$REPO"
TEST_OUTPUT=$(npm test 2>&1)
TEST_EXIT=$?

if [ $TEST_EXIT -eq 0 ]; then
  TOTAL=$(echo "$TEST_OUTPUT" | grep "^# tests" | awk '{print $3}')
  PASSED=$(echo "$TEST_OUTPUT" | grep "^# pass" | awk '{print $3}')
  FAILED=$(echo "$TEST_OUTPUT" | grep "^# fail" | awk '{print $3}')
  ok "npm test: $PASSED/$TOTAL tests pass, $FAILED fail"
else
  FIRST_FAIL=$(echo "$TEST_OUTPUT" | grep "^not ok" | head -3 | tr '\n' ' ')
  fail "npm test failed. First failures: $FIRST_FAIL"
fi

# ── C9: offline fixture-mode run produces 2 matches, 1 tonight ───────────────
echo ""
echo "Running offline fixture-mode digest..."
OFFLINE_OUT=$(node pipeline/run.js --fixtures test/fixtures --date 2026-06-12 2>&1)
OFFLINE_EXIT=$?

if [ $OFFLINE_EXIT -eq 0 ]; then
  ok "offline fixture-mode run exits 0"
else
  fail "offline fixture-mode run exited $OFFLINE_EXIT: $OFFLINE_OUT"
fi

if echo "$OFFLINE_OUT" | grep -q "Done: 2 matches"; then
  ok "offline run produces 2 finished matches"
else
  fail "offline run did not produce 2 matches. Output: $OFFLINE_OUT"
fi

if echo "$OFFLINE_OUT" | grep -q "1 tonight"; then
  ok "offline run produces 1 tonight fixture"
else
  fail "offline run did not produce 1 tonight fixture. Output: $OFFLINE_OUT"
fi

# ── C10: stats freeze — two polls with different possession → byte-identical ──
echo ""
echo "Running stats-freeze integration check..."
FREEZE_DIR=$(mktemp -d)
cleanup_freeze() { rm -rf "$FREEZE_DIR"; }
trap cleanup_freeze EXIT

POLL1="$FREEZE_DIR/poll1"
POLL2="$FREEZE_DIR/poll2"
mkdir -p "$POLL1" "$POLL2"

for DEST in "$POLL1" "$POLL2"; do
  cp "$REPO/test/fixtures/scoreboard.json" "$DEST/"
  cp "$REPO/test/fixtures/espn-standings.json" "$DEST/"
  cp "$REPO/test/fixtures/narration.json" "$DEST/"
  cp "$REPO/test/fixtures/summary-760415.json" "$DEST/"
done
cp "$REPO/test/fixtures/summary-760414.json" "$POLL1/"

# Poll 2 summary: possession tweaked 58.2 -> 57.9
node --input-type=module <<JSEOF
import { readFileSync, writeFileSync } from 'node:fs';
const summary = JSON.parse(readFileSync('$REPO/test/fixtures/summary-760414.json', 'utf8'));
summary.boxscore.teams[0].statistics.find(s => s.name === 'possessionPct').displayValue = '57.9';
summary.boxscore.teams[1].statistics.find(s => s.name === 'possessionPct').displayValue = '42.1';
writeFileSync('$POLL2/summary-760414.json', JSON.stringify(summary));
JSEOF

OUT="$FREEZE_DIR/out"
mkdir -p "$OUT"

node pipeline/run.js --fixtures "$POLL1" --date 2026-06-12 --out "$OUT" 2>/dev/null
AFTER1=$(cat "$OUT/2026-06-12.json")

POSSESSION1=$(echo "$AFTER1" | node --input-type=module -e "
import { createInterface } from 'node:readline';
let data = '';
process.stdin.on('data', c => data += c);
process.stdin.on('end', () => {
  const d = JSON.parse(data);
  const mex = d.matches.find(m => m.id === 760414);
  console.log(mex?.stats?.home?.possessionPct ?? 'null');
});
")

if [ "$POSSESSION1" = "58.2" ]; then
  ok "poll 1 recorded possession 58.2%"
else
  fail "poll 1 possession wrong: got $POSSESSION1, want 58.2"
fi

node pipeline/run.js --fixtures "$POLL2" --date 2026-06-12 --out "$OUT" 2>/dev/null
AFTER2=$(cat "$OUT/2026-06-12.json")

if [ "$AFTER1" = "$AFTER2" ]; then
  ok "stats freeze: poll-2 with possession 57.9% produced byte-identical digest"
else
  fail "stats freeze: digest changed after possession refinement (not frozen)"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "Results: $PASS passed, $FAIL failed"
if [ $FAIL -eq 0 ]; then
  echo "ALL CRITERIA PASS"
  exit 0
else
  echo "SOME CRITERIA FAILED"
  exit 1
fi

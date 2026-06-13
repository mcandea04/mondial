#!/usr/bin/env bash
#
# Executable acceptance-criteria check for the FIFA highlights integration.
# Translates the spec (docs/superpowers/specs/2026-06-13-fifa-highlights-design.md)
# into checks that exit 0 iff every gating criterion passes.
#
# Gating criteria (machine-checkable from the spec):
#   C1  Canonical filter keeps "… | FIFA World Cup 2026™ | Highlights" and drops
#       Alt Cast and Play Zone noise.
#   C2  Timestamp parsed via Date.UTC (host-TZ independent) — verified by forcing
#       a non-US TZ and asserting the kickoff ms is unchanged.
#   C3  Keying: kickoff-minute primary key, non-zero-seconds tolerance,
#       simultaneous-kickoff country-code guard, drop-never-guess, at-most-one.
#   C4  Tricode bridge: ENG→gb-eng, SCO→gb-sct, RSA→za, unknown→null.
#   C5  Error handling: retries a transient 5xx/throw then succeeds; soft-fails to
#       an empty map on a permanent 404 without throwing; never builds /watch/undefined.
#   C6  Offline fixtures run (--fixtures) attaches the two FIFA watch URLs to the
#       two finished matches and no others; teaser shows the recap count.
#   C7  Render path: render.js draws the ▶ Rezumat link from match.highlight, and
#       the built digest's highlights are all fifa.com/en/watch/<id> URLs.
#   C8  The HIGHLIGHTS_ENABLED gate is gone from run.js and .env.example; the
#       removed exports (parseRecapFeed, RECAP_FEED_URL) and recaps.xml are gone.
#
# The live FIFA-feed scenario is best-effort and NON-gating per the spec
# ("does not gate merge … publish latency may mean no reel"): it is run and
# reported, but never flips the exit code.
#
# Self-contained: installs deps if missing, runs the offline pipeline, cleans up
# its scratch output. No server needed (the site is static; the render assertion
# is a source + data check, not a browser run).

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PASS=0
FAIL=0

ok()   { echo "PASS: $1"; PASS=$((PASS + 1)); }
bad()  { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

# --- Setup: ensure deps so pipeline/run.js can import zod etc. -----------------
if [ ! -d node_modules ]; then
  echo "Installing dependencies (npm ci)…"
  npm ci >/dev/null 2>&1 || { echo "FATAL: npm ci failed"; exit 1; }
fi

OUT="$(mktemp -d)"
trap 'node -e "require(\"node:fs\").rmSync(process.argv[1],{recursive:true,force:true})" "$OUT" 2>/dev/null || true' EXIT

# --- C1..C5: pure-logic criteria, asserted in one node program ----------------
# Run under a non-US timezone to prove timestamp parsing does not depend on the
# host locale/TZ (spec: "never Date.parse … engine- and locale-dependent").
TZ="Asia/Kolkata" node --input-type=module -e '
import { parseHighlightFeed, recapsFor, fetchRecaps, CANONICAL_SUFFIX, LISTING_URL }
  from "./pipeline/highlights.js";
import { fifaTricodeToFlag } from "./pipeline/teams.js";
import { readFile } from "node:fs/promises";

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { console.log("PASS: " + name); pass++; }
                                else { console.log("FAIL: " + name); fail++; } };

const feed = JSON.parse(await readFile("test/fixtures/highlights.json", "utf8"));
const mex = { id: 537327, homeCode: "mx", awayCode: "za", utcDate: "2026-06-11T19:00:00Z" };
const can = { id: 537328, homeCode: "ca", awayCode: "qa", utcDate: "2026-06-12T02:00:00Z" };

// C1 canonical filter
const entries = parseHighlightFeed(feed);
check("C1 canonical filter keeps 2 reels, drops Alt Cast + Play Zone",
  entries.length === 2
  && entries.every((e) => e.url.startsWith("https://www.fifa.com/en/watch/"))
  && !entries.some((e) => e.url.includes("altCast") || e.url.includes("playZone")));

// C2 timestamp via Date.UTC, host-TZ independent (we are under Asia/Kolkata)
const mexEntry = entries.find((e) => e.url.endsWith("mexSudHighlight"));
check("C2 kickoff parsed as UTC regardless of host TZ",
  mexEntry.kickoffMs === Date.UTC(2026, 5, 11, 19, 0));

// C3a keys each video to the right match by kickoff minute
const base = recapsFor([mex, can], entries);
check("C3 keys videos to matches by kickoff minute",
  base.get(537327) === "https://www.fifa.com/en/watch/mexSudHighlight"
  && base.get(537328) === "https://www.fifa.com/en/watch/canQatHighlight");

// C3b non-zero seconds tolerance
const secs = recapsFor([{ ...mex, utcDate: "2026-06-11T19:00:43Z" }], entries);
check("C3 tolerates non-zero seconds in utcDate",
  secs.get(537327) === "https://www.fifa.com/en/watch/mexSudHighlight");

// C3c simultaneous kickoff disambiguated by country code
const simulEntries = [
  { url: "https://www.fifa.com/en/watch/aaa", kickoffMs: Date.UTC(2026,5,11,19,0), codes: ["mx","za"] },
  { url: "https://www.fifa.com/en/watch/bbb", kickoffMs: Date.UTC(2026,5,11,19,0), codes: ["fr","de"] },
];
const a = { id: 1, homeCode: "mx", awayCode: "za", utcDate: "2026-06-11T19:00:00Z" };
const b = { id: 2, homeCode: "fr", awayCode: "de", utcDate: "2026-06-11T19:00:00Z" };
const simul = recapsFor([a, b], simulEntries);
check("C3 disambiguates simultaneous kickoffs by flag code",
  simul.get(1) === "https://www.fifa.com/en/watch/aaa"
  && simul.get(2) === "https://www.fifa.com/en/watch/bbb");

// C3d drop, never guess: ambiguous (both codes null at the same minute) dropped
const ambEntries = [{ url: "https://www.fifa.com/en/watch/ccc", kickoffMs: Date.UTC(2026,5,11,19,0), codes: ["mx","za"] }];
const ph1 = { id: 10, homeCode: null, awayCode: null, utcDate: "2026-06-11T19:00:00Z" };
const ph2 = { id: 11, homeCode: null, awayCode: null, utcDate: "2026-06-11T19:00:00Z" };
check("C3 drops a still-ambiguous video (never guesses)",
  recapsFor([ph1, ph2], ambEntries).size === 0);

// C3e a video matching no finished match is dropped
const orphan = [{ url: "https://www.fifa.com/en/watch/zzz", kickoffMs: Date.UTC(2026,5,1,12,0), codes: ["br","hr"] }];
check("C3 drops a video that matches no finished match",
  recapsFor([mex, can], orphan).size === 0);

// C3f at most one per match: first feed-order entry wins
const dupEntries = [
  { url: "https://www.fifa.com/en/watch/first", kickoffMs: Date.UTC(2026,5,11,19,0), codes: ["mx","za"] },
  { url: "https://www.fifa.com/en/watch/reupload", kickoffMs: Date.UTC(2026,5,11,19,0), codes: ["mx","za"] },
];
check("C3 first feed-order entry wins for a match",
  recapsFor([mex], dupEntries).get(537327) === "https://www.fifa.com/en/watch/first");

// C4 tricode bridge
check("C4 tricode bridge maps ENG/SCO/RSA and returns null for unknown",
  fifaTricodeToFlag("ENG") === "gb-eng"
  && fifaTricodeToFlag("SCO") === "gb-sct"
  && fifaTricodeToFlag("RSA") === "za"
  && fifaTricodeToFlag("ZZZ") === null);

// C4b conversion through the feed, dropping unknown tricodes
const homeNations = parseHighlightFeed({ items: [{
  entryId: "homeNations",
  title: "England v Scotland" + CANONICAL_SUFFIX,
  semanticTags: [
    { sourceCategory: "Match", title: "England v Scotland on 06/15/2026 18:00 UTC", id: "3" },
    { sourceCategory: "Country", title: "England", id: "ENG" },
    { sourceCategory: "Country", title: "Scotland", id: "SCO" },
    { sourceCategory: "Country", title: "Nowhere", id: "ZZZ" },
  ],
}] })[0];
check("C4 feed converts tricodes incl. sub-national, drops unknown",
  JSON.stringify([...homeNations.codes].sort()) === JSON.stringify(["gb-eng","gb-sct"]));

// C5a retries a transient 5xx then succeeds
let calls = 0;
const body = JSON.stringify(feed);
const flaky = async () => {
  calls++;
  if (calls === 1) return { ok: false, status: 503, text: async () => "down" };
  return { ok: true, status: 200, text: async () => body };
};
const retried = await fetchRecaps({ matches: [mex, can], fetchImpl: flaky });
check("C5 retries a transient 5xx then succeeds",
  calls === 2 && retried.get(537327) === "https://www.fifa.com/en/watch/mexSudHighlight");

// C5b retries a thrown network error then succeeds
let tcalls = 0;
const throwOnce = async () => {
  tcalls++;
  if (tcalls === 1) throw new Error("ECONNRESET");
  return { ok: true, status: 200, text: async () => body };
};
const afterThrow = await fetchRecaps({ matches: [can], fetchImpl: throwOnce });
check("C5 retries a thrown network error then succeeds",
  tcalls === 2 && afterThrow.get(537328) === "https://www.fifa.com/en/watch/canQatHighlight");

// C5c soft-fails to empty map on permanent 404 without throwing (warn silenced)
const origWarn = console.warn; console.warn = () => {};
let softFail;
try { softFail = await fetchRecaps({ matches: [mex], fetchImpl: async () => ({ ok: false, status: 404, text: async () => "nope" }) }); }
finally { console.warn = origWarn; }
check("C5 soft-fails to an empty map on a permanent 404", softFail.size === 0);

// C5d per-item validation: empty entryId skipped, never /watch/undefined
const malformed = parseHighlightFeed({ items: [
  { entryId: "", title: "Bad" + CANONICAL_SUFFIX,
    semanticTags: [{ sourceCategory: "Match", title: "X v Y on 06/11/2026 19:00 UTC", id: "1" }] },
  { entryId: "goodOne", title: "Good" + CANONICAL_SUFFIX,
    semanticTags: [
      { sourceCategory: "Match", title: "X v Y on 06/11/2026 20:00 UTC", id: "2" },
      { sourceCategory: "Country", title: "Mexico", id: "MEX" },
    ] },
] });
check("C5 skips empty-entryId item, never builds /watch/undefined",
  malformed.length === 1
  && malformed[0].url === "https://www.fifa.com/en/watch/goodOne"
  && !malformed.some((e) => e.url.endsWith("/undefined")));

// Sanity: LISTING_URL is the FIFA section feed with limit=50
check("LISTING_URL targets the FIFA section feed with limit=50",
  LISTING_URL.startsWith("https://cxm-api.fifa.com/") && LISTING_URL.includes("limit=50"));

console.log("LOGIC_RESULT " + pass + " " + fail);
process.exit(fail === 0 ? 0 : 1);
' > "$OUT/logic.txt" 2>&1
LOGIC_EXIT=$?
grep -E '^(PASS|FAIL):' "$OUT/logic.txt" || true
if [ "$LOGIC_EXIT" -eq 0 ]; then ok "C1-C5 pure-logic criteria"; else bad "C1-C5 pure-logic criteria (see above)"; fi

# --- C6: offline fixtures run attaches the right URLs and teaser count --------
node -e 'require("node:fs").rmSync(process.argv[1],{recursive:true,force:true})' "$OUT/run" 2>/dev/null || true
if node pipeline/run.js --fixtures test/fixtures --date 2026-06-12 --out "$OUT/run" >/dev/null 2>&1; then
  C6=$(node -e '
    const d = require(process.argv[1] + "/2026-06-12.json");
    const withHi = d.matches.filter((m) => m.highlight);
    const expected = {
      537327: "https://www.fifa.com/en/watch/mexSudHighlight",
      537328: "https://www.fifa.com/en/watch/canQatHighlight",
    };
    const urlsRight = withHi.length === 2
      && withHi.every((m) => m.highlight === expected[m.id]);
    const noExtras = d.matches.filter((m) => m.highlight && !(m.id in expected)).length === 0;
    const teaserCount = /2 rezumate video/.test(d.teaser);
    console.log(urlsRight && noExtras && teaserCount ? "OK" : "BAD");
  ' "$OUT/run")
  if [ "$C6" = "OK" ]; then ok "C6 offline run attaches both FIFA URLs and teaser recap count"; else bad "C6 offline run output wrong"; fi
else
  bad "C6 offline pipeline run failed"
fi

# --- C7: render path draws the link from match.highlight ----------------------
if grep -q "match.highlight" site/assets/render.js && grep -q "▶ Rezumat" site/assets/render.js; then
  C7=$(node -e '
    const d = require(process.argv[1] + "/2026-06-12.json");
    const hi = d.matches.filter((m) => m.highlight);
    console.log(hi.length > 0 && hi.every((m) => /^https:\/\/www\.fifa\.com\/en\/watch\/.+/.test(m.highlight)) ? "OK" : "BAD");
  ' "$OUT/run")
  if [ "$C7" = "OK" ]; then ok "C7 render.js draws ▶ Rezumat from match.highlight, all FIFA watch URLs"; else bad "C7 digest highlight URLs not all FIFA watch links"; fi
else
  bad "C7 render.js no longer draws the ▶ Rezumat link from match.highlight"
fi

# --- C8: the gate and the dead El Gráfico surface are gone --------------------
GATE_REFS=$(grep -rn "HIGHLIGHTS_ENABLED" pipeline/ .env.example 2>/dev/null || true)
DEAD_REFS=$(grep -rn "parseRecapFeed\|RECAP_FEED_URL\|matchRecap\|spanishTeamName" pipeline/ 2>/dev/null || true)
XML_GONE=$([ -f test/fixtures/recaps.xml ] && echo "present" || echo "gone")
if [ -z "$GATE_REFS" ] && [ -z "$DEAD_REFS" ] && [ "$XML_GONE" = "gone" ]; then
  ok "C8 HIGHLIGHTS_ENABLED gate, dead El Gráfico exports and recaps.xml all removed"
else
  bad "C8 leftover refs — gate:[$GATE_REFS] dead:[$DEAD_REFS] recaps.xml:$XML_GONE"
fi

# --- Live one-off (NON-gating, reported only) ---------------------------------
echo "--- live FIFA feed check (best-effort, non-gating) ---"
node scripts/check-fifa-highlights.js 2>&1 | sed 's/^/  /' || echo "  (live check errored; non-gating per spec)"

# --- Verdict ------------------------------------------------------------------
echo "================================================"
echo "Gating: $PASS passed, $FAIL failed"
if [ "$FAIL" -eq 0 ]; then
  echo "SCENARIO RESULT: PASS"
  exit 0
else
  echo "SCENARIO RESULT: FAIL"
  exit 1
fi

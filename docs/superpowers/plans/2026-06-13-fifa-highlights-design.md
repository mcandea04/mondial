# FIFA Highlights Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dead El Gráfico YouTube highlight source with FIFA's public highlights JSON feed, keying each finished match to its official `fifa.com/en/watch/<id>` reel by kickoff minute and country code.

**Architecture:** Rewrite `pipeline/highlights.js` to fetch FIFA's section-news JSON feed, filter to canonical match reels, parse each into `{ url, kickoffMs, codes }`, and resolve them to finished matches by minute-precision kickoff with a country-code collision guard. A new `FIFA_TRICODE_TO_FLAG` map in `teams.js` bridges FIFA tricodes to our flag codes. `run.js` loses the `HIGHLIGHTS_ENABLED` gate; the feature is always on with soft-fail as the only safety valve. Highlights remain a fact fetched by code and keyed by match `id` — never produced by narration.

**Tech Stack:** Node 20 ESM, `node:test`, `node --test`, vanilla `fetch`. No new dependencies.

---

## Background facts the implementer must hold

These come from the spec (`docs/superpowers/specs/2026-06-13-fifa-highlights-design.md`) and the current code. Read them before starting.

**Current `pipeline/highlights.js`** exports `RECAP_FEED_URL`, `parseRecapFeed`, `matchRecap`, `recapsFor`, `fetchRecaps`. It keys El Gráfico Spanish recap titles by team-name + score. All of this is being replaced.

**Current `run.js` integration surface** (do NOT rename these — downstream depends on them):
- `run.js:45` imports `{ fetchRecaps, parseRecapFeed, recapsFor }` from `./highlights.js`.
- `run.js:150-165` `getRecaps(finished, { fixtures })` — local wrapper. Keep this name.
- `run.js:265` `const recapByMatch = await getRecaps(...)`.
- `run.js:279` `highlight: recapByMatch.get(m.id) ?? null` — per-match field.
- `run.js:296` `recapCount: recapByMatch.size` into the teaser.
- `run.js:330-331` manifest recap count: `(day.matches ?? []).filter((m) => m.highlight).length`.

**Match facts available for keying** (from `pipeline/fetch.js:189-201`, `parseMatch`):
- `utcDate` — ISO string from football-data (may carry seconds).
- `homeCode` / `awayCode` — our flag codes via `flagCode()`, or `null` for knockout placeholders.
- `id` — football-data match id.

**FIFA feed shape** (verified group stage, `cxm-api.fifa.com`, no auth):

    {
      "items": [
        {
          "entryId": "7wv3jFr0T2wczSuQbhgrSW",
          "title": "Mexico v South Africa | Group A | FIFA World Cup 2026™ | Highlights",
          "semanticTags": [
            { "sourceCategory": "Match",   "title": "Mexico ... South Africa on 06/11/2026 19:00 UTC", "id": "400021443" },
            { "sourceCategory": "Country", "title": "Mexico",       "id": "MEX" },
            { "sourceCategory": "Country", "title": "South Africa", "id": "RSA" }
          ]
        }
      ]
    }

- Watch URL = `https://www.fifa.com/en/watch/<entryId>`.
- Kickoff parsed from the `sourceCategory: "Match"` tag title suffix `… on MM/DD/YYYY HH:mm UTC`.
- Country codes come from `sourceCategory: "Country"` tag `id` fields (FIFA tricodes).

**Two finished fixture matches** (`test/fixtures/matches.json`) the new `highlights.json` fixture must cover:
- id `537327` Mexico v South Africa, kickoff `2026-06-11T19:00:00Z`, codes `mx`/`za`.
- id `537328` Canada v Qatar, kickoff `2026-06-12T02:00:00Z`, codes `ca`/`qa`.

---

## File Structure

- **Modify** `pipeline/teams.js` — add `FIFA_TRICODE_TO_FLAG` map + `fifaTricodeToFlag()` accessor. Remove the now-dead `SPANISH_NAMES` map and `spanishTeamName()` (only `highlights.js` used them, and that usage is being deleted).
- **Rewrite** `pipeline/highlights.js` — FIFA feed client + parser + resolver. New exports: `LISTING_URL`, `SECTION_ID`, `CANONICAL_SUFFIX`, `parseHighlightFeed`, `recapsFor`, `fetchRecaps`. Removed: `RECAP_FEED_URL`, `parseRecapFeed`, `matchRecap`.
- **Modify** `pipeline/run.js` — drop `HIGHLIGHTS_ENABLED` gate, switch fixtures branch to `highlights.json` + `parseHighlightFeed`, update import.
- **Modify** `.env.example` — remove `HIGHLIGHTS_ENABLED=` line and its comment.
- **Create** `test/fixtures/highlights.json` — captured-shape FIFA listing covering the two finished fixture matches plus noise.
- **Delete** `test/fixtures/recaps.xml`.
- **Rewrite** `test/highlights.test.js` — all-offline cases against `highlights.json` + injected `fetchImpl`.
- **Modify** `test/run.test.js:117-147` — drop `HIGHLIGHTS_ON` env, switch to `highlights.json`, delete the "disabled by default" test, keep manifest recap-count assertions.
- **Create** `scripts/check-fifa-highlights.js` — manual live network check (not a `node --test` case); also audits live-feed tricodes against `FIFA_TRICODE_TO_FLAG`.

---

## Task 1: Add the FIFA tricode → flag-code bridge to teams.js

**Files:**
- Modify: `pipeline/teams.js`
- Test: `test/highlights.test.js` (covered in Task 5; this task is verified by a temporary inline check)

The bridge maps FIFA tricodes (not ISO-3) to our existing flag codes. The 48 finalists are exactly the keys of `FLAG_CODES` in `teams.js`. The implementer hand-authors the tricode→flag rows from the confirmed finalists. FIFA tricodes differ from ISO-3 (`RSA` not `ZAF`, `GER` not `DEU`) and from ISO-2; below is the full table to write literally.

- [ ] **Step 1: Add the `FIFA_TRICODE_TO_FLAG` map and accessor to `pipeline/teams.js`**

Add this block immediately after the `flagCodeValues()` function (after line 133, before the `SPANISH_NAMES` block which Step 3 deletes):

```javascript
/**
 * FIFA tricodes (as they appear in the highlights feed's Country tags) mapped to
 * our flag-icons codes. FIFA tricodes are not ISO-3166 (RSA not ZAF, GER not
 * DEU), so this is a hand-authored table, not a derived one. Covers the 48
 * finalists; the home nations use flag-icons sub-national codes. An unknown
 * tricode returns null, meaning that side cannot confirm a kickoff collision.
 */
const FIFA_TRICODE_TO_FLAG = {
  ALG: 'dz',
  ARG: 'ar',
  AUS: 'au',
  AUT: 'at',
  BEL: 'be',
  BIH: 'ba',
  BRA: 'br',
  CAN: 'ca',
  CPV: 'cv',
  COL: 'co',
  COD: 'cd',
  CRO: 'hr',
  CUW: 'cw',
  CZE: 'cz',
  ECU: 'ec',
  EGY: 'eg',
  ENG: 'gb-eng',
  FRA: 'fr',
  GER: 'de',
  GHA: 'gh',
  HAI: 'ht',
  IRN: 'ir',
  IRQ: 'iq',
  CIV: 'ci',
  JPN: 'jp',
  JOR: 'jo',
  MEX: 'mx',
  MAR: 'ma',
  NED: 'nl',
  NZL: 'nz',
  NOR: 'no',
  PAN: 'pa',
  PAR: 'py',
  POR: 'pt',
  QAT: 'qa',
  KSA: 'sa',
  SCO: 'gb-sct',
  SEN: 'sn',
  RSA: 'za',
  KOR: 'kr',
  ESP: 'es',
  SWE: 'se',
  SUI: 'ch',
  TUN: 'tn',
  TUR: 'tr',
  USA: 'us',
  URU: 'uy',
  UZB: 'uz',
};

export function fifaTricodeToFlag(tricode) {
  return FIFA_TRICODE_TO_FLAG[tricode] ?? null;
}
```

- [ ] **Step 2: Verify the bridge with a one-off node check**

Run:

```bash
cd /Users/mcandea/personal/mondial-fifa-highlights-design && node -e "import('./pipeline/teams.js').then(m => { console.log(m.fifaTricodeToFlag('RSA'), m.fifaTricodeToFlag('ENG'), m.fifaTricodeToFlag('SCO'), m.fifaTricodeToFlag('ZZZ')); })"
```

Expected output:

```
za gb-eng gb-sct null
```

- [ ] **Step 3: Remove the dead Spanish-name map and accessor**

`SPANISH_NAMES` and `spanishTeamName()` (`teams.js:135-193`) existed only to match El Gráfico Spanish recap titles. After the highlights rewrite nothing imports them. Delete the entire block from the comment `/**\n * Spanish exonyms keyed by the Romanian name …` through the closing of `spanishTeamName`, i.e. delete lines 135-193 (the JSDoc, the `SPANISH_NAMES` const, and the `spanishTeamName` function). Leave the file ending with a single trailing newline after `fifaTricodeToFlag`.

- [ ] **Step 4: Confirm nothing else imports `spanishTeamName`**

Run:

```bash
cd /Users/mcandea/personal/mondial-fifa-highlights-design && grep -rn "spanishTeamName\|SPANISH_NAMES" pipeline/ test/ scripts/ site/ || echo "NO REFERENCES"
```

Expected: `NO REFERENCES` (the only previous reference was `highlights.js:15`, which Task 2 rewrites).

- [ ] **Step 5: Commit**

```bash
cd /Users/mcandea/personal/mondial-fifa-highlights-design && git add pipeline/teams.js && git commit -m "Add FIFA tricode to flag-code bridge, drop dead Spanish names"
```

---

## Task 2: Rewrite pipeline/highlights.js — feed client, parser, resolver

**Files:**
- Rewrite: `pipeline/highlights.js`
- Test: `test/highlights.test.js` (Task 5 drives the real tests; here we replace the module and smoke-check it loads)

This task replaces the whole module. The exported surface that `run.js` consumes (`fetchRecaps`, `recapsFor`) keeps its names and shapes; `parseRecapFeed`/`matchRecap` are removed and `parseHighlightFeed` is added.

Design decisions locked by the spec:
- Canonical filter: keep only `title.endsWith(CANONICAL_SUFFIX)` where the suffix is `' | FIFA World Cup 2026™ | Highlights'` (note the `™` glyph).
- Timestamp: parse with an explicit regex into `Date.UTC(...)`, never `Date.parse` on the FIFA string.
- `parseHighlightFeed(json)` → `[{ url, kickoffMs, codes }]`, codes already converted to our flag codes, malformed canonical items skipped silently/individually, noise dropped silently.
- `recapsFor(matches, entries)` → `Map<matchId, url>`, keyed by minute-floored kickoff with a country-code collision guard, first-in-array wins, drop on zero/ambiguous.
- `fetchRecaps({ matches, fetchImpl = fetch })` → wraps `fetchImpl` in a short bounded retry (2-3 attempts, ~1-3s backoff) for transient failures (429/5xx/thrown), soft-fails to empty Map on permanent failures.

- [ ] **Step 1: Replace the entire contents of `pipeline/highlights.js`**

```javascript
/**
 * Official FIFA match highlights, linked to a finished game as a fact.
 *
 * FIFA publishes highlight reels on its public watch pages (no auth, no key)
 * and exposes them through a section-news JSON feed. We read the feed, keep only
 * canonical match reels, and key each to a finished match by kickoff minute and
 * country code. Per-goal clips, Alt Cast reimaginings and Play Zone items fail
 * the canonical suffix and are dropped.
 *
 * A highlight URL is a fact, not voice: it is fetched here and merged in run.js,
 * keyed by match id, never produced by the narration model. A feed outage must
 * never fail the digest, so fetchRecaps soft-fails to an empty map.
 */

import { fifaTricodeToFlag } from './teams.js';

const SECTION_ID = '1klF18lgpe12FFtd1IoTSs';
const LISTING_URL = `https://cxm-api.fifa.com/fifaplusweb/api/sections/news/${SECTION_ID}?locale=en&limit=50`;

export { SECTION_ID, LISTING_URL };

const CANONICAL_SUFFIX = ' | FIFA World Cup 2026™ | Highlights';
export { CANONICAL_SUFFIX };

const WATCH_BASE = 'https://www.fifa.com/en/watch/';

const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 1000;

/** Floors an epoch-ms value to the whole minute (FIFA carries minute precision). */
function floorToMinute(ms) {
  return Math.floor(ms / 60_000) * 60_000;
}

/**
 * Parses "… on MM/DD/YYYY HH:mm UTC" into epoch ms via Date.UTC. Returns null
 * when the suffix is absent or unparseable. Never uses Date.parse, whose
 * MM/DD/YYYY handling is engine- and locale-dependent.
 */
function parseKickoffMs(matchTagTitle) {
  const m = matchTagTitle?.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})\s+UTC$/);
  if (!m) return null;
  const [, mm, dd, yyyy, hh, min] = m;
  return Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min));
}

/**
 * Parses the FIFA listing JSON into canonical highlight entries.
 * Each entry is { url, kickoffMs, codes } where codes is an unordered array of
 * our flag codes (length 1 or 2; null tricodes are dropped). Non-canonical items
 * are dropped silently; canonical-but-malformed items are skipped individually.
 */
export function parseHighlightFeed(json) {
  const items = Array.isArray(json?.items) ? json.items : [];
  const entries = [];
  for (const item of items) {
    const title = item?.title;
    if (typeof title !== 'string' || !title.endsWith(CANONICAL_SUFFIX)) continue;

    const entryId = item?.entryId;
    if (typeof entryId !== 'string' || entryId.length === 0) continue;

    const tags = Array.isArray(item?.semanticTags) ? item.semanticTags : [];
    const matchTag = tags.find((t) => t?.sourceCategory === 'Match');
    const kickoffMs = parseKickoffMs(matchTag?.title);
    if (kickoffMs === null) continue;

    const codes = tags
      .filter((t) => t?.sourceCategory === 'Country')
      .map((t) => fifaTricodeToFlag(t?.id))
      .filter((code) => code !== null);

    entries.push({ url: `${WATCH_BASE}${entryId}`, kickoffMs, codes });
  }
  return entries;
}

/** True when the entry's codes confirm the match (at least one side matches). */
function codesConfirmMatch(entry, match) {
  return entry.codes.some((code) => code === match.homeCode || code === match.awayCode);
}

/**
 * Maps finished-match ids to highlight URLs. Keys each entry by kickoff minute;
 * when more than one finished match shares the minute (simultaneous group games)
 * the country-code guard disambiguates. An entry resolving to zero or, after the
 * guard, still more than one match is dropped (never guessed). First entry in
 * array order wins per match.
 */
export function recapsFor(matches, entries) {
  const recaps = new Map();
  for (const entry of entries) {
    const sameMinute = matches.filter(
      (m) => floorToMinute(Date.parse(m.utcDate)) === entry.kickoffMs,
    );
    const resolved =
      sameMinute.length === 1 ? sameMinute : sameMinute.filter((m) => codesConfirmMatch(entry, m));
    if (resolved.length !== 1) continue;
    const match = resolved[0];
    if (!recaps.has(match.id)) recaps.set(match.id, entry.url);
  }
  return recaps;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isTransientStatus(status) {
  return status === 429 || status >= 500;
}

/**
 * Fetches the FIFA highlights feed once (with a short bounded retry on transient
 * failures) and maps finished-match ids to watch URLs. Never throws: a permanent
 * failure, a 404, or a body with no usable items shape soft-fails to an empty
 * map so a FIFA outage cannot break the digest.
 */
export async function fetchRecaps({ matches, fetchImpl = fetch }) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(LISTING_URL);
    } catch (error) {
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_BASE_MS * attempt);
        continue;
      }
      console.warn(`FIFA highlights feed unavailable; skipping highlights: ${error.message}`);
      return new Map();
    }

    if (!response.ok) {
      if (isTransientStatus(response.status) && attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_BASE_MS * attempt);
        continue;
      }
      console.warn(`FIFA highlights feed returned ${response.status}; skipping highlights.`);
      return new Map();
    }

    let json;
    try {
      json = JSON.parse(await response.text());
    } catch (error) {
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_BASE_MS * attempt);
        continue;
      }
      console.warn(`FIFA highlights feed returned unparseable JSON; skipping highlights.`);
      return new Map();
    }

    return recapsFor(matches, parseHighlightFeed(json));
  }
  return new Map();
}
```

- [ ] **Step 2: Smoke-check the module loads and parses an empty feed**

Run:

```bash
cd /Users/mcandea/personal/mondial-fifa-highlights-design && node -e "import('./pipeline/highlights.js').then(m => { console.log(typeof m.fetchRecaps, typeof m.recapsFor, typeof m.parseHighlightFeed, m.LISTING_URL.includes('limit=50'), m.parseHighlightFeed({items: []}).length); })"
```

Expected output:

```
function function function true 0
```

- [ ] **Step 3: Confirm the removed exports are gone and nothing stale references them**

Run:

```bash
cd /Users/mcandea/personal/mondial-fifa-highlights-design && grep -rn "parseRecapFeed\|matchRecap\|RECAP_FEED_URL" pipeline/ scripts/ site/ || echo "NO STALE REFS IN SOURCE"
```

Expected: it will still show `pipeline/run.js:45` (the import) — that is fixed in Task 3. Note this for Task 3. Test files are handled in Task 5/6.

- [ ] **Step 4: Commit**

```bash
cd /Users/mcandea/personal/mondial-fifa-highlights-design && git add pipeline/highlights.js && git commit -m "Rewrite highlights module to read FIFA highlights feed"
```

---

## Task 3: Wire run.js to the FIFA path and remove the HIGHLIGHTS_ENABLED gate

**Files:**
- Modify: `pipeline/run.js:45` (import), `pipeline/run.js:150-165` (`getRecaps`)
- Modify: `.env.example`

- [ ] **Step 1: Update the highlights import in `run.js`**

Replace line 45:

```javascript
import { fetchRecaps, parseRecapFeed, recapsFor } from './highlights.js';
```

with:

```javascript
import { fetchRecaps, parseHighlightFeed, recapsFor } from './highlights.js';
```

- [ ] **Step 2: Rewrite `getRecaps` (run.js:150-165) to drop the gate and read `highlights.json`**

Replace the whole JSDoc + function (lines 150-165):

```javascript
/**
 * Maps finished-match ids to recap URLs. Disabled by default: the recap source
 * has unresolved publishing rights, so this returns an empty map unless
 * HIGHLIGHTS_ENABLED=1. Offline (--fixtures) it reads recaps.xml from the dir
 * when present and skips the network otherwise. Always returns a Map; never
 * throws, so a feed outage cannot fail the digest.
 */
async function getRecaps(finished, { fixtures }) {
  if (process.env.HIGHLIGHTS_ENABLED !== '1') return new Map();
  if (fixtures) {
    const cannedPath = path.join(fixtures, 'recaps.xml');
    if (!existsSync(cannedPath)) return new Map();
    return recapsFor(finished, parseRecapFeed(await readFile(cannedPath, 'utf8')));
  }
  return fetchRecaps({ matches: finished });
}
```

with:

```javascript
/**
 * Maps finished-match ids to FIFA highlight URLs. Offline (--fixtures) it reads
 * highlights.json from the dir when present and skips the network otherwise.
 * Always returns a Map; never throws, so a feed outage cannot fail the digest.
 */
async function getRecaps(finished, { fixtures }) {
  if (fixtures) {
    const cannedPath = path.join(fixtures, 'highlights.json');
    if (!existsSync(cannedPath)) return new Map();
    return recapsFor(finished, parseHighlightFeed(await readJson(cannedPath)));
  }
  return fetchRecaps({ matches: finished });
}
```

Note: `readJson` is already defined in `run.js:82`. The fixtures branch now parses JSON (not XML text), matching the live path which feeds `parseHighlightFeed` the parsed object.

- [ ] **Step 3: Remove the `HIGHLIGHTS_ENABLED` line and comment from `.env.example`**

Read `.env.example` first, then delete the line `HIGHLIGHTS_ENABLED=` (around line 15) and any adjacent comment that mentions unresolved publishing rights / the highlights knob. Leave the rest of the file intact with a trailing newline.

- [ ] **Step 4: Confirm no stale references remain in source**

Run:

```bash
cd /Users/mcandea/personal/mondial-fifa-highlights-design && grep -rn "HIGHLIGHTS_ENABLED\|parseRecapFeed\|RECAP_FEED_URL\|recaps.xml" pipeline/ .env.example || echo "CLEAN"
```

Expected: `CLEAN`.

- [ ] **Step 5: Commit**

```bash
cd /Users/mcandea/personal/mondial-fifa-highlights-design && git add pipeline/run.js .env.example && git commit -m "Wire run.js to FIFA highlights, remove HIGHLIGHTS_ENABLED gate"
```

---

## Task 4: Create the FIFA highlights fixture, delete recaps.xml

**Files:**
- Create: `test/fixtures/highlights.json`
- Delete: `test/fixtures/recaps.xml`

The fixture mirrors the real FIFA listing shape and carries the quirks the spec calls out: FIFA tricodes (`RSA`), the `™` suffix, at least one one-sided-Country item, and one Alt Cast noise item. It must key the two finished fixture matches:
- `537327` Mexico v South Africa, `2026-06-11T19:00:00Z` → codes `mx`/`za` (FIFA `MEX`/`RSA`).
- `537328` Canada v Qatar, `2026-06-12T02:00:00Z` → codes `ca`/`qa` (FIFA `CAN`/`QAT`).

- [ ] **Step 1: Write `test/fixtures/highlights.json`**

```json
{
  "items": [
    {
      "entryId": "altCastMexRsa",
      "title": "Alt Cast Highlights: Mexico v South Africa | FIFA World Cup 2026",
      "semanticTags": [
        { "sourceCategory": "Match", "title": "Mexico v South Africa on 06/11/2026 19:00 UTC", "id": "400021443" },
        { "sourceCategory": "Country", "title": "Mexico", "id": "MEX" }
      ]
    },
    {
      "entryId": "mexSudHighlight",
      "title": "Mexico v South Africa | Group A | FIFA World Cup 2026™ | Highlights",
      "semanticTags": [
        { "sourceCategory": "Match", "title": "Mexico v South Africa on 06/11/2026 19:00 UTC", "id": "400021443" },
        { "sourceCategory": "Country", "title": "Mexico", "id": "MEX" },
        { "sourceCategory": "Country", "title": "South Africa", "id": "RSA" }
      ]
    },
    {
      "entryId": "canQatHighlight",
      "title": "Canada v Qatar | Group B | FIFA World Cup 2026™ | Highlights",
      "semanticTags": [
        { "sourceCategory": "Match", "title": "Canada v Qatar on 06/12/2026 02:00 UTC", "id": "400021444" },
        { "sourceCategory": "Country", "title": "Canada", "id": "CAN" }
      ]
    },
    {
      "entryId": "playZoneNoise",
      "title": "Mexico v South Africa | Play Zone",
      "semanticTags": [
        { "sourceCategory": "Match", "title": "Mexico v South Africa on 06/11/2026 19:00 UTC", "id": "400021443" }
      ]
    }
  ]
}
```

Notes for the implementer: the `canQatHighlight` item is deliberately one-sided (only a `Canada` Country tag) to exercise the one-sided-Country path; it still keys by kickoff minute since no other finished fixture match shares `2026-06-12T02:00 UTC`. The Alt Cast and Play Zone items are noise that must be dropped by the canonical suffix.

- [ ] **Step 2: Verify the fixture keys both finished matches**

Run:

```bash
cd /Users/mcandea/personal/mondial-fifa-highlights-design && node -e "
import('./pipeline/highlights.js').then(async (h) => {
  const fs = await import('node:fs/promises');
  const json = JSON.parse(await fs.readFile('test/fixtures/highlights.json', 'utf8'));
  const entries = h.parseHighlightFeed(json);
  const matches = [
    { id: 537327, homeCode: 'mx', awayCode: 'za', utcDate: '2026-06-11T19:00:00Z' },
    { id: 537328, homeCode: 'ca', awayCode: 'qa', utcDate: '2026-06-12T02:00:00Z' },
  ];
  const recaps = h.recapsFor(matches, entries);
  console.log('entries', entries.length);
  console.log(537327, recaps.get(537327));
  console.log(537328, recaps.get(537328));
});
"
```

Expected output:

```
entries 2
537327 https://www.fifa.com/en/watch/mexSudHighlight
537328 https://www.fifa.com/en/watch/canQatHighlight
```

- [ ] **Step 3: Delete `recaps.xml`**

Run:

```bash
cd /Users/mcandea/personal/mondial-fifa-highlights-design && git rm test/fixtures/recaps.xml
```

- [ ] **Step 4: Commit**

```bash
cd /Users/mcandea/personal/mondial-fifa-highlights-design && git add test/fixtures/highlights.json && git commit -m "Replace recaps.xml fixture with FIFA highlights.json"
```

---

## Task 5: Rewrite test/highlights.test.js

**Files:**
- Rewrite: `test/highlights.test.js`

All cases run offline against `test/fixtures/highlights.json` and injected `fetchImpl`. The case numbering mirrors the spec's Testing section (1-11). Test output must stay clean — assert on warns or suppress them; here the retry/soft-fail cases are driven so the warn IS expected, so we silence `console.warn` for those specific cases and restore it after.

- [ ] **Step 1: Replace the entire contents of `test/highlights.test.js`**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHighlightFeed, recapsFor, fetchRecaps, CANONICAL_SUFFIX } from '../pipeline/highlights.js';

const FIXTURES = path.join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures');
const feed = JSON.parse(await readFile(path.join(FIXTURES, 'highlights.json'), 'utf8'));

const mexicoMatch = { id: 537327, homeCode: 'mx', awayCode: 'za', utcDate: '2026-06-11T19:00:00Z' };
const canadaMatch = { id: 537328, homeCode: 'ca', awayCode: 'qa', utcDate: '2026-06-12T02:00:00Z' };

/** Runs fn with console.warn silenced; returns the captured warn messages. */
async function withSilencedWarn(fn) {
  const original = console.warn;
  const warns = [];
  console.warn = (msg) => warns.push(msg);
  try {
    await fn();
  } finally {
    console.warn = original;
  }
  return warns;
}

// 1. Canonical filter keeps highlights, drops Alt Cast and Play Zone.
test('parseHighlightFeed keeps canonical reels and drops Alt Cast and Play Zone', () => {
  const entries = parseHighlightFeed(feed);
  assert.equal(entries.length, 2);
  assert.ok(entries.every((e) => e.url.startsWith('https://www.fifa.com/en/watch/')));
  assert.ok(!entries.some((e) => e.url.includes('altCast')));
  assert.ok(!entries.some((e) => e.url.includes('playZone')));
});

// 2. Extracts entryId -> watch URL, kickoff ms (UTC, host-TZ independent), codes.
test('parseHighlightFeed extracts watch URL, UTC kickoff ms and flag codes', () => {
  const entry = parseHighlightFeed(feed).find((e) => e.url.endsWith('mexSudHighlight'));
  assert.equal(entry.url, 'https://www.fifa.com/en/watch/mexSudHighlight');
  assert.equal(entry.kickoffMs, Date.UTC(2026, 5, 11, 19, 0));
  assert.deepEqual([...entry.codes].sort(), ['mx', 'za']);
});

// 3. recapsFor keys a video to the right match by kickoff minute.
test('recapsFor keys a video to the right match by kickoff minute', () => {
  const recaps = recapsFor([mexicoMatch, canadaMatch], parseHighlightFeed(feed));
  assert.equal(recaps.get(537327), 'https://www.fifa.com/en/watch/mexSudHighlight');
  assert.equal(recaps.get(537328), 'https://www.fifa.com/en/watch/canQatHighlight');
});

// 4. Seconds tolerance: a utcDate with non-zero seconds still keys to the minute.
test('recapsFor tolerates non-zero seconds in football-data utcDate', () => {
  const withSeconds = { ...mexicoMatch, utcDate: '2026-06-11T19:00:43Z' };
  const recaps = recapsFor([withSeconds], parseHighlightFeed(feed));
  assert.equal(recaps.get(537327), 'https://www.fifa.com/en/watch/mexSudHighlight');
});

// 5. Simultaneous kickoff disambiguated by flag code.
test('recapsFor disambiguates simultaneous kickoffs by flag code', () => {
  const entries = [
    { url: 'https://www.fifa.com/en/watch/aaa', kickoffMs: Date.UTC(2026, 5, 11, 19, 0), codes: ['mx', 'za'] },
    { url: 'https://www.fifa.com/en/watch/bbb', kickoffMs: Date.UTC(2026, 5, 11, 19, 0), codes: ['fr', 'de'] },
  ];
  const matchA = { id: 1, homeCode: 'mx', awayCode: 'za', utcDate: '2026-06-11T19:00:00Z' };
  const matchB = { id: 2, homeCode: 'fr', awayCode: 'de', utcDate: '2026-06-11T19:00:00Z' };
  const recaps = recapsFor([matchA, matchB], entries);
  assert.equal(recaps.get(1), 'https://www.fifa.com/en/watch/aaa');
  assert.equal(recaps.get(2), 'https://www.fifa.com/en/watch/bbb');
});

// 6. A video matching no finished match is dropped.
test('recapsFor drops a video whose kickoff matches no finished match', () => {
  const orphan = [{ url: 'https://www.fifa.com/en/watch/zzz', kickoffMs: Date.UTC(2026, 5, 1, 12, 0), codes: ['br', 'hr'] }];
  const recaps = recapsFor([mexicoMatch, canadaMatch], orphan);
  assert.equal(recaps.size, 0);
});

// 7. Still-ambiguous after the guard (incl. both-codes-null knockout placeholder) is dropped.
test('recapsFor drops a video that stays ambiguous after the code guard', () => {
  const entries = [
    { url: 'https://www.fifa.com/en/watch/ccc', kickoffMs: Date.UTC(2026, 5, 11, 19, 0), codes: ['mx', 'za'] },
  ];
  // Two placeholder matches at the same minute, both codes null: nothing can confirm.
  const placeholderA = { id: 10, homeCode: null, awayCode: null, utcDate: '2026-06-11T19:00:00Z' };
  const placeholderB = { id: 11, homeCode: null, awayCode: null, utcDate: '2026-06-11T19:00:00Z' };
  const recaps = recapsFor([placeholderA, placeholderB], entries);
  assert.equal(recaps.size, 0);
});

// 8. At-most-one-per-match: first canonical item in feed order wins.
test('recapsFor keeps the first feed-order entry when two resolve to the same match', () => {
  const entries = [
    { url: 'https://www.fifa.com/en/watch/first', kickoffMs: Date.UTC(2026, 5, 11, 19, 0), codes: ['mx', 'za'] },
    { url: 'https://www.fifa.com/en/watch/reupload', kickoffMs: Date.UTC(2026, 5, 11, 19, 0), codes: ['mx', 'za'] },
  ];
  const recaps = recapsFor([mexicoMatch], entries);
  assert.equal(recaps.get(537327), 'https://www.fifa.com/en/watch/first');
});

// 9. fetchRecaps retries transient failures then succeeds; soft-fails on permanent 404.
test('fetchRecaps retries a 5xx then succeeds via injected fetch', async () => {
  let calls = 0;
  const body = JSON.stringify(feed);
  const flaky = async () => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 503, text: async () => 'down' };
    return { ok: true, status: 200, text: async () => body };
  };
  const recaps = await fetchRecaps({ matches: [mexicoMatch, canadaMatch], fetchImpl: flaky });
  assert.equal(calls, 2);
  assert.equal(recaps.get(537327), 'https://www.fifa.com/en/watch/mexSudHighlight');
});

test('fetchRecaps retries a thrown network error then succeeds', async () => {
  let calls = 0;
  const body = JSON.stringify(feed);
  const flaky = async () => {
    calls += 1;
    if (calls === 1) throw new Error('ECONNRESET');
    return { ok: true, status: 200, text: async () => body };
  };
  const recaps = await fetchRecaps({ matches: [canadaMatch], fetchImpl: flaky });
  assert.equal(calls, 2);
  assert.equal(recaps.get(537328), 'https://www.fifa.com/en/watch/canQatHighlight');
});

test('fetchRecaps soft-fails to an empty map on a permanent 404', async () => {
  const notFound = async () => ({ ok: false, status: 404, text: async () => 'nope' });
  let recaps;
  const warns = await withSilencedWarn(async () => {
    recaps = await fetchRecaps({ matches: [mexicoMatch], fetchImpl: notFound });
  });
  assert.equal(recaps.size, 0);
  assert.equal(warns.length, 1);
});

// 10. Per-item validation: empty entryId is skipped, no .../watch/undefined.
test('parseHighlightFeed skips a canonical item with an empty entryId', () => {
  const malformed = {
    items: [
      {
        entryId: '',
        title: `Bad Item${CANONICAL_SUFFIX}`,
        semanticTags: [{ sourceCategory: 'Match', title: 'X v Y on 06/11/2026 19:00 UTC', id: '1' }],
      },
      {
        entryId: 'goodOne',
        title: `Good Item${CANONICAL_SUFFIX}`,
        semanticTags: [
          { sourceCategory: 'Match', title: 'X v Y on 06/11/2026 20:00 UTC', id: '2' },
          { sourceCategory: 'Country', title: 'Mexico', id: 'MEX' },
        ],
      },
    ],
  };
  const entries = parseHighlightFeed(malformed);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].url, 'https://www.fifa.com/en/watch/goodOne');
  assert.ok(!entries.some((e) => e.url.endsWith('/undefined')));
});

// 11. Tricode -> flag-code conversion through the feed (incl. sub-national; unknown -> dropped).
test('parseHighlightFeed converts FIFA tricodes incl. sub-national, dropping unknown ones', () => {
  const item = {
    items: [
      {
        entryId: 'homeNations',
        title: `England v Scotland${CANONICAL_SUFFIX}`,
        semanticTags: [
          { sourceCategory: 'Match', title: 'England v Scotland on 06/15/2026 18:00 UTC', id: '3' },
          { sourceCategory: 'Country', title: 'England', id: 'ENG' },
          { sourceCategory: 'Country', title: 'Scotland', id: 'SCO' },
          { sourceCategory: 'Country', title: 'Nowhere', id: 'ZZZ' },
        ],
      },
    ],
  };
  const entry = parseHighlightFeed(item)[0];
  assert.deepEqual([...entry.codes].sort(), ['gb-eng', 'gb-sct']);
});
```

- [ ] **Step 2: Run the highlights test file**

Run:

```bash
cd /Users/mcandea/personal/mondial-fifa-highlights-design && node --test test/highlights.test.js
```

Expected: all tests pass, no spurious `console.warn` output in the log (the 404 case silences its warn).

- [ ] **Step 3: Commit**

```bash
cd /Users/mcandea/personal/mondial-fifa-highlights-design && git add test/highlights.test.js && git commit -m "Rewrite highlights tests for the FIFA feed"
```

---

## Task 6: Migrate test/run.test.js off the gate

**Files:**
- Modify: `test/run.test.js:117-147`

With the gate gone, highlights are on by default. Drop the `HIGHLIGHTS_ON` env override, switch the recap-drop test to overwrite `highlights.json`, and delete the "disabled by default" test (its premise no longer exists). The fixture `highlights.json` keys both finished matches, so the count assertion stays `2`.

- [ ] **Step 1: Replace lines 117-147 of `test/run.test.js`**

Replace this block:

```javascript
const HIGHLIGHTS_ON = { HIGHLIGHTS_ENABLED: '1' };

test('manifest carries per-day recap counts when highlights are enabled', () => {
  const { fixtures, out } = freshDirs();
  runPipeline({ fixtures, out, env: HIGHLIGHTS_ON });
  const manifest = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.dates, [DATE]);
  // The recaps.xml fixture links both finished matches.
  assert.equal(manifest.recaps[DATE], 2);
});

test('manifest omits days with no recaps from the recaps map', () => {
  const { fixtures, out } = freshDirs();
  // Drop the recap feed so no match is linked.
  writeFileSync(path.join(fixtures, 'recaps.xml'), '<feed></feed>');
  runPipeline({ fixtures, out, env: HIGHLIGHTS_ON });
  const manifest = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.dates, [DATE]);
  assert.equal(manifest.recaps[DATE], undefined);
});

test('highlights disabled by default: no links, no recap clause, no recaps map', () => {
  const { fixtures, out } = freshDirs();
  // recaps.xml is present in fixtures, but the feature is off unless opted in.
  runPipeline({ fixtures, out });
  const digest = readDigest(out);
  assert.ok(digest.matches.every((m) => m.highlight === null), 'no match carries a highlight');
  assert.ok(!/rezumat/.test(digest.teaser), 'teaser has no recap clause');
  const manifest = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.recaps, {}, 'recaps map is empty');
});
```

with:

```javascript
test('manifest carries per-day recap counts from the FIFA highlights feed', () => {
  const { fixtures, out } = freshDirs();
  runPipeline({ fixtures, out });
  const manifest = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.dates, [DATE]);
  // The highlights.json fixture keys both finished matches.
  assert.equal(manifest.recaps[DATE], 2);
});

test('manifest omits days with no recaps from the recaps map', () => {
  const { fixtures, out } = freshDirs();
  // Empty the highlights feed so no match is linked.
  writeFileSync(path.join(fixtures, 'highlights.json'), JSON.stringify({ items: [] }));
  runPipeline({ fixtures, out });
  const manifest = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.dates, [DATE]);
  assert.equal(manifest.recaps[DATE], undefined);
});
```

- [ ] **Step 2: Run the run.test.js file**

Run:

```bash
cd /Users/mcandea/personal/mondial-fifa-highlights-design && node --test test/run.test.js
```

Expected: all tests pass. The first new test confirms `manifest.recaps[DATE] === 2` (both finished matches keyed), the second confirms an empty feed yields no recaps entry.

- [ ] **Step 3: Commit**

```bash
cd /Users/mcandea/personal/mondial-fifa-highlights-design && git add test/run.test.js && git commit -m "Migrate run tests off the HIGHLIGHTS_ENABLED gate"
```

---

## Task 7: Add the manual live-network check script

**Files:**
- Create: `scripts/check-fifa-highlights.js`

This is NOT a `node --test` case (it would flake CI). It is a self-contained manual scenario: it hits the real FIFA feed and prints the keyed `matchId → url` map for a small hardcoded recent-night match list, so it needs no `FOOTBALL_DATA_TOKEN`. It exits non-zero only on a thrown error, not on an empty map.

**Tricode audit (why this script also dumps observed tricodes):** the `FIFA_TRICODE_TO_FLAG` map in Task 1 is the load-bearing collision guard, but only `MEX`/`RSA` were ever observed in a captured sample — the other 46 rows are hand-authored from memory of FIFA's tricode conventions. If even one key is wrong (e.g. the feed emits `SAU` while the map has `KSA`, or `ALGE` vs `ALG`), that nation's tricode silently maps to `null`, the collision guard can't confirm its side, and on a simultaneous-kickoff group matchday the correct match can ship with no highlight — no error, no test signal (the offline fixture only exercises `MEX`/`RSA`/`CAN`/`QAT`). The soft-fail safety valve does NOT catch a wrong-but-plausible tricode. So this manual script, when run against a live multi-match feed, also collects every `Country` tag `id` it observes and diffs the set against the map keys, printing any tricode FIFA emits that the map does not cover. This turns the unverifiable hand-authored table into a one-command live audit before the table is trusted in production. It is still manual and non-gating — it surfaces drift for a human, it does not change pipeline behavior.

- [ ] **Step 1: Write `scripts/check-fifa-highlights.js`**

```javascript
/**
 * Manual live check (not a node --test case): fetches the real FIFA highlights
 * feed and (a) prints the keyed matchId -> url map for a small hardcoded
 * recent-night match list and (b) audits every Country tricode the live feed
 * emits against the FIFA_TRICODE_TO_FLAG map, printing any the map does not
 * cover. Self-contained: needs no FOOTBALL_DATA_TOKEN. Exits non-zero only on a
 * thrown error, never on an empty map or an unmapped-tricode finding.
 *
 * The tricode audit exists because the 48-row map is hand-authored from memory
 * (only MEX/RSA were ever observed live); a wrong-but-plausible key maps a real
 * nation to null and silently drops its highlight on a simultaneous-kickoff
 * matchday, with no error and no test signal. Run this against a live
 * multi-match feed before trusting the table.
 *
 * Run: node scripts/check-fifa-highlights.js
 *
 * Update RECENT_NIGHT before running for a fresh night: the kickoff utcDate must
 * be minute-accurate against football-data, and the codes are our flag codes.
 */

import { fetchRecaps, parseHighlightFeed, LISTING_URL, CANONICAL_SUFFIX } from '../pipeline/highlights.js';
import { fifaTricodeToFlag } from '../pipeline/teams.js';

const RECENT_NIGHT = [
  { id: 537327, homeCode: 'mx', awayCode: 'za', utcDate: '2026-06-11T19:00:00Z' },
  { id: 537328, homeCode: 'ca', awayCode: 'qa', utcDate: '2026-06-12T02:00:00Z' },
];

/**
 * Collects every Country tag id (FIFA tricode) on canonical items in the live
 * feed and returns those the map does not cover (fifaTricodeToFlag -> null).
 * Only canonical items are audited so Alt Cast / Play Zone noise tricodes do not
 * raise false drift. Returns [] if the feed can't be read (this audit is
 * best-effort and never throws on a feed problem).
 */
async function unmappedTricodes() {
  let response;
  try {
    response = await fetch(LISTING_URL);
    if (!response.ok) return [];
  } catch {
    return [];
  }
  let json;
  try {
    json = JSON.parse(await response.text());
  } catch {
    return [];
  }
  const items = Array.isArray(json?.items) ? json.items : [];
  const observed = new Set();
  for (const item of items) {
    if (typeof item?.title !== 'string' || !item.title.endsWith(CANONICAL_SUFFIX)) continue;
    const tags = Array.isArray(item?.semanticTags) ? item.semanticTags : [];
    for (const tag of tags) {
      if (tag?.sourceCategory === 'Country' && typeof tag.id === 'string') observed.add(tag.id);
    }
  }
  return [...observed].filter((tricode) => fifaTricodeToFlag(tricode) === null).sort();
}

async function main() {
  const recaps = await fetchRecaps({ matches: RECENT_NIGHT });
  if (recaps.size === 0) {
    console.log('No highlights keyed (feed may not have published these reels yet).');
  } else {
    for (const [id, url] of recaps) {
      console.log(`${id} -> ${url}`);
    }
  }

  const unmapped = await unmappedTricodes();
  if (unmapped.length === 0) {
    console.log('Tricode audit: every Country tricode in the live feed is mapped.');
  } else {
    console.log(`Tricode audit: ${unmapped.length} unmapped tricode(s) in the live feed:`);
    for (const tricode of unmapped) console.log(`  ${tricode} -> (no flag code; FIX FIFA_TRICODE_TO_FLAG)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Verify the script runs without throwing (offline-safe)**

Run:

```bash
cd /Users/mcandea/personal/mondial-fifa-highlights-design && node scripts/check-fifa-highlights.js; echo "exit=$?"
```

Expected: `exit=0`. With network it prints `id -> url` lines for any published reels plus a `Tricode audit:` line; with no network or no published reels it prints the "No highlights keyed" line and the audit reports nothing unmapped (the feed read soft-fails to no observed tricodes). Either way it must not throw, and the audit never changes the exit code — an unmapped tricode is reported for a human to fix, not a failure.

- [ ] **Step 3: Commit**

```bash
cd /Users/mcandea/personal/mondial-fifa-highlights-design && git add scripts/check-fifa-highlights.js && git commit -m "Add manual FIFA highlights live-network check script"
```

---

## Task 8: Full verification (scenarios before declaring done)

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run:

```bash
cd /Users/mcandea/personal/mondial-fifa-highlights-design && npm test
```

Expected: all test files pass, output is clean (no stray warns, no XML/`recaps.xml` errors).

- [ ] **Step 2: Scenario 1 — offline fixtures run attaches the expected URLs and a teaser recap count**

Run:

```bash
cd /Users/mcandea/personal/mondial-fifa-highlights-design && rm -rf tmp/out && node pipeline/run.js --fixtures test/fixtures --date 2026-06-12 && node -e "
const d = require('./tmp/out/2026-06-12.json');
for (const m of d.matches) console.log(m.id, m.home, 'v', m.away, '->', m.highlight);
console.log('TEASER:', d.teaser);
"
```

Expected: both finished matches carry `https://www.fifa.com/en/watch/...` URLs, and the teaser contains a `rezumate video` clause (recap count 2). No other match carries a highlight.

- [ ] **Step 3: Scenario 3 — render check**

Confirm `site/assets/render.js:99-101` still draws the `▶ Rezumat` link from `match.highlight` (unchanged), and that the digest JSON from Step 2 has `highlight` URLs only for keyed matches. Inspect the rendered link target:

```bash
cd /Users/mcandea/personal/mondial-fifa-highlights-design && grep -n "highlight" site/assets/render.js && node -e "
const d = require('./tmp/out/2026-06-12.json');
console.log('matches with highlight:', d.matches.filter(m => m.highlight).length);
console.log('all FIFA watch links:', d.matches.filter(m => m.highlight).every(m => m.highlight.startsWith('https://www.fifa.com/en/watch/')));
"
```

Expected: `render.js` references `match.highlight` for the link; the digest has 2 matches with `https://www.fifa.com/en/watch/...` highlights.

- [ ] **Step 4: Scenario 2 — live one-off (network, manual, non-gating)**

Run:

```bash
cd /Users/mcandea/personal/mondial-fifa-highlights-design && node scripts/check-fifa-highlights.js
```

Expected (with VPN/network and published reels): `537327 -> https://www.fifa.com/en/watch/<id>` style lines. This is best-effort and does not gate completion (publish latency may mean no reel for a fresh game). If it prints "No highlights keyed" or soft-fails, that is acceptable per the spec; the offline scenarios (Steps 2-3) are sufficient for "done".

- [ ] **Step 5: Run code-simplifier on changed files, then re-run scenarios**

Per the task-completion protocol, run the code-simplifier subagent over the changed files (`pipeline/highlights.js`, `pipeline/teams.js`, `pipeline/run.js`, `test/highlights.test.js`, `test/run.test.js`, `scripts/check-fifa-highlights.js`), then re-run `npm test` and Scenario 1 to confirm nothing broke. Commit any simplification with message `Simplify FIFA highlights implementation`.

- [ ] **Step 6: Final clean-tree check**

Run:

```bash
cd /Users/mcandea/personal/mondial-fifa-highlights-design && git status --short && git log --oneline -8
```

Expected: working tree clean, commits for each task present.

---

## Self-Review Notes (author check against the spec)

- **Source API / constants** — `LISTING_URL`, `SECTION_ID`, `CANONICAL_SUFFIX` are named constants at the module top (Task 2), not env-overridable. ✓
- **Canonical filter** — single `title.endsWith(CANONICAL_SUFFIX)` rule with the `™` glyph; Alt Cast and Play Zone fixture items prove the drop (Task 4 fixture, Task 5 test 1). ✓
- **Timestamp parsing** — explicit regex into `Date.UTC`, never `Date.parse` on the FIFA string; test 2 asserts UTC ms host-TZ-independently. ✓
- **Match resolution** — minute floor primary key (test 3), seconds tolerance (test 4), country-code collision guard (test 5), drop-never-guess incl. both-codes-null (test 6, 7). ✓
- **At most one per match** — first feed-order entry wins via `!recaps.has` guard (test 8). ✓
- **Tricode bridge** — hardcoded literal in `teams.js`, 48 rows, sub-national codes, unknown → null (Task 1, test 11). The 46 unobserved rows are hand-authored; the live check script (Task 7) audits the real feed's Country tricodes against the map keys so a wrong-but-plausible key surfaces before production, instead of silently dropping a highlight. ✓
- **Module structure** — `fetchRecaps`/`recapsFor` keep names + shapes; `parseHighlightFeed` added; `parseRecapFeed`/`matchRecap` removed (Task 2). `run.js` `getRecaps` name kept (Task 3). ✓
- **run.js + .env.example** — gate removed, fixtures branch reads `highlights.json` via `parseHighlightFeed`+`recapsFor`, import updated, `.env.example` line removed (Task 3). ✓
- **Error handling** — bounded short retry on 429/5xx/thrown/unparseable-JSON; soft-fail on permanent/404/no-items; noise dropped silently; per-item validation; no `/watch/undefined` (Task 2, tests 9, 10). ✓
- **Offline / fixtures** — `recaps.xml` deleted, `highlights.json` created with the required quirks, both paths funnel through `recapsFor` (Task 3, 4). ✓
- **Testing** — both existing test files migrated in lockstep; 11 spec cases covered; output clean (Task 5, 6). ✓
- **Live check** — under `scripts/`, self-contained, non-gating, exits non-zero only on throw (Task 7). ✓
- **Verification scenarios** — all three run in Task 8. ✓

# Highlights Backfill + Stable Teaser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the highlight-link backfill safe and self-stopping: the teaser count no longer goes stale, stored links survive feed outages, and repeated runs auto-stop once the digest stabilises.

**Architecture:** Three coordinated changes in `pipeline/teaser.js` and `pipeline/run.js`. The teaser drops `recapCount` and always appends `, cu rezumate video` when matches exist. The highlight merge becomes monotonic — fresh fetch wins, but a soft-fail empty map never overwrites stored links. A byte-compare gate under `--require-complete` skips the deploy when the rebuilt digest is identical to the stored one, so runs auto-stop without any explicit "all links present" check.

**Tech Stack:** Node 20 ESM, `node:test`, no new dependencies.

---

## Known limitations (accepted before implementation)

Two doubt-pass findings were reviewed and accepted rather than redesigned:

**`index.html` OG block can stay stale after a crash (HIGH, accepted).** The
change-gate is placed before any write so it cannot strand `latest.json` (see
Task 5 Step 3 rationale). The trade-off: `index.html`'s OG block is written last,
so if a prior run crashed *after* writing `<date>.json`/`latest.json`/
`manifest.json` but *before* patching `index.html`, the next run rebuilds an
identical digest, the gate fires, and `index.html` is not repaired. This window
is small (a crash between two adjacent writes) and self-clears on the next run
that changes the digest (a new highlight, a late correction, or a `--re-narrate`
force run, all of which make the gate not fire). Manual repair path if it ever
sticks: dispatch `deploy.yml` (`workflow_dispatch`) to re-deploy the committed
`site/` without re-running the pipeline. Not worth moving the gate, because doing
so reopens the `latest.json` stranding hole.

**Spec Scenario is authoritative as of the latest spec edit.** The spec's
Scenario section was rewritten to the real two-finished-match fixture world
(matching this plan). If you still see a "4 matches / 3 of 4" version anywhere,
it is stale — **follow Task 6 of this plan**, which is the authoritative
end-to-end verification (two-match base sequence plus an optional four-match
variant built by patching two `TIMED` fixtures into the night window).

---

## Background facts the implementer must hold

Read these before starting — they explain why each change is shaped the way it is.

**Current `pipeline/teaser.js`:** `gamesLabel(matchCount, recapCount)` returns `"N meciuri + M rezumate video azi-noapte"` when `recapCount > 0`, else `"N meciuri azi-noapte"`, else `"pauză azi-noapte"`. `buildTeaser` accepts `{ headline, matchCount, recapCount, siteUrl }`. The recap count is baked in at first-publish time, before most reels exist, so the first share message sent to the group is already stale.

**Current `pipeline/run.js` highlight merge (line 276):**
```javascript
highlight: recapByMatch.get(m.id) ?? null,
```
`fetchRecaps` soft-fails to an **empty map** on any FIFA feed outage. On an outage, every already-stored link is overwritten with `null`, the file changes, `writeIfChanged` re-commits the regression, and the early-stop gate (once added) would re-open the backfill chase. The monotonic merge prevents this.

**Current `pipeline/run.js` existing-digest read (lines 243-249):** lives inside `if (!args.reNarrate)`. The monotonic merge (task B) and the change-gate (task C) also need the stored digest. The read must be lifted above that block so all three users share one read call.

**`run.js:289-295` teaser call site:**
```javascript
teaser: buildTeaser({
  headline: narration.headline,
  matchCount: facts.finished.length,
  recapCount: recapByMatch.size,
  siteUrl,
}),
```
After task A, `recapCount` is removed from `buildTeaser`'s API; the `recapByMatch.size` argument must be deleted from this call site too.

**Why byte-compare beats a facts-hash gate (spec §C):** `factsHash` only covers scores and tonight fixtures — it deliberately omits scorers, cards, and standings (fields enriched late from ESPN). A `factsHash`-identical skip would drop a real late-scorer/card correction. The full-digest byte compare catches every published field, so any real change still deploys.

**`--require-complete` and `--fixtures` interaction:** the live readiness gate (lines 218-227) is skipped under `--fixtures`. The new change-gate is in-memory vs. on-disk only, so it IS exercised under `--fixtures` — this is what makes the offline scenario runnable without network.

**`test/fixtures/matches.json` has exactly 2 FINISHED matches:** ids 537327 (Mexico v South Africa, `2026-06-11T19:00Z`) and 537328 (Canada v Qatar, `2026-06-12T02:00Z`). Ids 537330 (Brazil v Morocco) and 537331 (Qatar v New Zealand) have status `TIMED` — they are tonight's fixtures, not last-night's finished games. `selectDigestMatches` in `fetch.js` requires `status === 'FINISHED'` to put a match into `facts.finished`; the TIMED pair never enters that set, never gets a `highlight` field, and never appears in `digest.matches`. `facts.finished.length` is 2, so `matchCount` in the teaser is 2.

**`test/fixtures/highlights.json` covers both finished matches:** `mexSudHighlight` and `canQatHighlight` both parse as canonical reels (two-country tags + CANONICAL_SUFFIX title). The two other entries (`altCastMexRsa`, `playZoneNoise`) fail `CANONICAL_SUFFIX` and are dropped by `parseHighlightFeed`. So the default fixture already provides highlights for both finished matches — full coverage on first run. This means Scenario 2's re-run will produce a byte-identical digest and the gate WILL fire (already published). See Scenario 2 corrections below.

**Scenarios 4 and 5 require flipping 537330/537331 to FINISHED and also patching their utcDate:** those matches are TIMED in the fixture and their original dates (`2026-06-12T19:00Z` and `2026-06-13T01:00Z`) both fall outside the 2026-06-12 night window (`[2026-06-11 16:00 UTC, 2026-06-12 06:00 UTC)`). `selectDigestMatches` filters by both `status === 'FINISHED'` AND `isInNightWindow(m.utcDate, window)`, so status alone is not enough. The patched utcDates must be inside the window — use `2026-06-11T21:00Z` and `2026-06-11T23:00Z`. The highlights feed title timestamps must match the patched utcDates exactly. See Task 6 Step 5 for the full instructions.

**Match `id` stability invariant:** the monotonic merge keys stored→fresh by `m.id`. football-data ids are stable for a scheduled match. A match that leaves `facts.finished` entirely drops from the digest; its stored link is not preserved — this is correct.

---

## File Structure

- **Modify** `pipeline/teaser.js` — drop `recapCount` parameter from `gamesLabel` and `buildTeaser`; always append `, cu rezumate video` when `matchCount > 0`.
- **Modify** `pipeline/run.js` — lift existing-digest read above the `reNarrate` block; add monotonic highlight merge; add publish-only-on-change gate under `--require-complete`; remove `recapCount` from the `buildTeaser` call site.
- **Rewrite** `test/teaser.test.js` — new expected strings for the count-free format; remove `recapCount` from all `buildTeaser` calls.
- **Modify** `test/run.test.js` — add monotonic merge unit helper + 3 cases; add 2 gate integration cases; update any teaser-string assertions that contain `rezumate`.

---

## Task 1: Rewrite pipeline/teaser.js — count-free format

**Files:**
- Modify: `pipeline/teaser.js`
- Test: `test/teaser.test.js`

- [ ] **Step 1: Write the failing tests first**

Replace the entire contents of `test/teaser.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTeaser } from '../pipeline/teaser.js';

const URL = 'https://mcandea04.github.io/mondial/';

test('plural matches: recap clause appended with comma before azi-noapte', () => {
  const teaser = buildTeaser({ headline: 'Test', matchCount: 4, siteUrl: URL });
  assert.equal(teaser, `⚽ Test · 4 meciuri azi-noapte, cu rezumate video\n${URL}`);
});

test('singular match: recap clause appended', () => {
  const teaser = buildTeaser({ headline: 'Test', matchCount: 1, siteUrl: URL });
  assert.equal(teaser, `⚽ Test · 1 meci azi-noapte, cu rezumate video\n${URL}`);
});

test('zero matches: pauza clause with no recap mention', () => {
  const teaser = buildTeaser({ headline: 'Pauză', matchCount: 0, siteUrl: URL });
  assert.equal(teaser, `⚽ Pauză · pauză azi-noapte\n${URL}`);
});

test('buildTeaser does not accept recapCount (ignored if passed)', () => {
  // Passing recapCount must not change the output — it is no longer part of the API.
  const withCount = buildTeaser({ headline: 'Test', matchCount: 2, recapCount: 99, siteUrl: URL });
  const withoutCount = buildTeaser({ headline: 'Test', matchCount: 2, siteUrl: URL });
  assert.equal(withCount, withoutCount);
  assert.equal(withCount, `⚽ Test · 2 meciuri azi-noapte, cu rezumate video\n${URL}`);
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run:

```bash
node --test test/teaser.test.js
```

Expected: tests fail because the current `gamesLabel` still uses `recapCount`.

- [ ] **Step 3: Rewrite `pipeline/teaser.js`**

Replace the entire file contents:

```javascript
/** WhatsApp share text: headline + match count + URL. */

function gamesLabel(matchCount) {
  if (matchCount === 0) return 'pauză azi-noapte';
  const matches = matchCount === 1 ? '1 meci' : `${matchCount} meciuri`;
  return `${matches} azi-noapte, cu rezumate video`;
}

export function buildTeaser({ headline, matchCount, siteUrl }) {
  return `⚽ ${headline} · ${gamesLabel(matchCount)}\n${siteUrl}`;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run:

```bash
node --test test/teaser.test.js
```

Expected: all 4 tests pass, no warnings.

- [ ] **Step 5: Commit**

```bash
git add pipeline/teaser.js test/teaser.test.js
git commit -m "feat: drop recap count from teaser, always append recap clause"
```

---

## Task 2: Lift the existing-digest read in run.js

**Files:**
- Modify: `pipeline/run.js:243-249`

The current code reads the stored digest only inside `if (!args.reNarrate)`. The monotonic merge (Task 3) and the change-gate (Task 4) need the stored digest unconditionally. This task moves the read to a shared `existing` variable above the block. No behaviour changes — this is a pure refactor that sets up the next two tasks.

- [ ] **Step 1: Locate the current existing-digest read block**

Read `pipeline/run.js` lines 238-262. The block looks like:

```javascript
  let narration = null;
  let reused = false;
  if (!args.reNarrate) {
    const existing = await readJsonOrNull(path.join(dataDir, `${date}.json`));
    if (existing && (!existing.factsHash || existing.factsHash === hash)) {
      narration = reuseNarration(existing, facts);
      reused = narration != null;
    }
  }
```

- [ ] **Step 2: Lift the read above the block**

Replace the block above with:

```javascript
  const existing = await readJsonOrNull(path.join(dataDir, `${date}.json`));

  let narration = null;
  let reused = false;
  if (!args.reNarrate) {
    if (existing && (!existing.factsHash || existing.factsHash === hash)) {
      narration = reuseNarration(existing, facts);
      reused = narration != null;
    }
  }
```

`existing` is now in scope for all code below it in `main()`.

- [ ] **Step 3: Smoke-check the pipeline still runs**

Run:

```bash
node pipeline/run.js --fixtures test/fixtures --date 2026-06-12
```

Expected: runs to completion with `Done: ...` output, no errors.

- [ ] **Step 4: Run the full test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add pipeline/run.js
git commit -m "refactor: lift existing-digest read above reNarrate block"
```

---

## Task 3: Add monotonic highlight merge in run.js

**Files:**
- Modify: `pipeline/run.js` (highlight assembly in `digest` object, ~line 276)
- Test: `test/run.test.js`

- [ ] **Step 1: Write the failing unit tests**

Open `test/run.test.js` and append these tests at the end of the file. They test a pure merge helper that Task 3 will extract:

```javascript
import { mergeHighlight } from '../pipeline/run.js';

test('monotonic merge: stored link survives a feed outage (empty recapByMatch)', () => {
  const stored = new Map([[537327, 'https://www.fifa.com/en/watch/mexSudHighlight']]);
  const fresh = new Map(); // simulated outage
  assert.equal(mergeHighlight(537327, fresh, stored), 'https://www.fifa.com/en/watch/mexSudHighlight');
});

test('monotonic merge: fresh link wins over stored link (correction)', () => {
  const stored = new Map([[537327, 'https://www.fifa.com/en/watch/oldLink']]);
  const fresh = new Map([[537327, 'https://www.fifa.com/en/watch/newLink']]);
  assert.equal(mergeHighlight(537327, fresh, stored), 'https://www.fifa.com/en/watch/newLink');
});

test('monotonic merge: no stored, no fresh -> null', () => {
  const stored = new Map();
  const fresh = new Map();
  assert.equal(mergeHighlight(537327, fresh, stored), null);
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run:

```bash
node --test test/run.test.js
```

Expected: the three new tests fail because `mergeHighlight` is not exported from `run.js` yet.

- [ ] **Step 3: Export `mergeHighlight` from `pipeline/run.js`**

Add this exported pure function near the other small helpers (e.g. after `writeIfChanged`, before `requireEnv`):

```javascript
/**
 * Picks the highlight URL for one match, preferring a freshly fetched link.
 * Falls back to the stored link when the fresh map is empty (feed outage),
 * then null. This ensures a stored link is never overwritten by null on a
 * transient FIFA outage.
 *
 * Invariant: recapByMatch only holds truthy URL strings. A falsy value in the
 * map would defeat monotonicity. Never put null/"" into the map.
 */
export function mergeHighlight(matchId, recapByMatch, existingHighlightById) {
  return recapByMatch.get(matchId) ?? existingHighlightById.get(matchId) ?? null;
}
```

- [ ] **Step 4: Build `existingHighlightById` and wire `mergeHighlight` in the digest assembly**

In `main()`, directly before the `digest` object literal, add:

```javascript
  const existingHighlightById = new Map(
    (existing?.matches ?? []).map((m) => [m.id, m.highlight]),
  );
```

Then in the `digest.matches` map (currently `highlight: recapByMatch.get(m.id) ?? null`), replace that line with:

```javascript
      highlight: mergeHighlight(m.id, recapByMatch, existingHighlightById),
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run:

```bash
node --test test/run.test.js
```

Expected: all tests including the three new ones pass.

- [ ] **Step 6: Run the full test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add pipeline/run.js test/run.test.js
git commit -m "feat: monotonic highlight merge — stored links survive feed outages"
```

---

## Task 4: Remove recapCount from the buildTeaser call site in run.js

**Files:**
- Modify: `pipeline/run.js` (~line 289)

The teaser API no longer accepts `recapCount` (Task 1). Remove the argument from the call site.

- [ ] **Step 1: Find and update the buildTeaser call**

The current call in `run.js` is:

```javascript
    teaser: buildTeaser({
      headline: narration.headline,
      matchCount: facts.finished.length,
      recapCount: recapByMatch.size,
      siteUrl,
    }),
```

Replace it with:

```javascript
    teaser: buildTeaser({
      headline: narration.headline,
      matchCount: facts.finished.length,
      siteUrl,
    }),
```

- [ ] **Step 2: Run the full test suite**

Run:

```bash
npm test
```

Expected: all tests pass. Any teaser assertion that previously expected `rezumate video` with a count (e.g. `+ 2 rezumate video`) now expects the count-free form. If any existing test in `test/run.test.js` asserts on the exact teaser string, update it to the new format `azi-noapte, cu rezumate video`.

- [ ] **Step 3: Commit**

```bash
git add pipeline/run.js
git commit -m "chore: remove recapCount from buildTeaser call site"
```

---

## Task 5: Add the publish-only-on-change gate in run.js

**Files:**
- Modify: `pipeline/run.js`
- Test: `test/run.test.js`

- [ ] **Step 1: Write the failing integration tests**

Append to `test/run.test.js`:

```javascript
test('--require-complete: identical second run skips deploy (published=false in log)', () => {
  const { fixtures, out } = freshDirs();
  // First run: no stored digest, always publishes.
  const firstLog = runPipeline({ fixtures, out, extra: ['--require-complete'] });
  assert.match(firstLog, /Done:/);

  // Second run: same fixtures, same stored digest -> gate skips deploy.
  const secondLog = runPipeline({ fixtures, out, extra: ['--require-complete'] });
  assert.match(secondLog, /nothing changed; already published/);
});

test('--require-complete: run after a new highlight link still deploys', () => {
  const { fixtures, out } = freshDirs();
  // Write highlights covering only 1 of 2 finished matches.
  writeFileSync(
    path.join(fixtures, 'highlights.json'),
    JSON.stringify({
      items: [
        {
          entryId: 'mexSudHighlight',
          title: 'Mexico v South Africa | Group A | FIFA World Cup 2026™ | Highlights',
          semanticTags: [
            { sourceCategory: 'Match', title: 'Mexico v South Africa on 06/11/2026 19:00 UTC', id: '400021443' },
            { sourceCategory: 'Country', title: 'Mexico', id: 'MEX' },
            { sourceCategory: 'Country', title: 'South Africa', id: 'RSA' },
          ],
        },
      ],
    }),
  );
  runPipeline({ fixtures, out, extra: ['--require-complete'] });
  const firstDigest = readDigest(out);
  assert.equal(firstDigest.matches.filter((m) => m.highlight).length, 1);

  // Now add the second highlight.
  cpSync(path.join(ROOT, 'test', 'fixtures', 'highlights.json'), path.join(fixtures, 'highlights.json'));
  const secondLog = runPipeline({ fixtures, out, extra: ['--require-complete'] });
  // Digest changed (new link added) -> must deploy, not skip.
  assert.doesNotMatch(secondLog, /nothing changed; already published/);
  const secondDigest = readDigest(out);
  assert.equal(secondDigest.matches.filter((m) => m.highlight).length, 2);
});
```

Note: `cpSync` is already imported in `run.test.js` at line 6. Verify the import covers this usage.

- [ ] **Step 2: Run the tests to confirm they fail**

Run:

```bash
node --test test/run.test.js
```

Expected: the two new gate tests fail (no "nothing changed" log line exists yet).

- [ ] **Step 3: Add the change-gate to `run.js`**

Insert the gate BEFORE the `writeIfChanged(path.join(dataDir, `${date}.json`), ...)` call — that is, immediately after the `digest` object is fully assembled and the OG image is written, but before any JSON file is touched:

```javascript
  // Publish-only-on-change gate (under --require-complete): when the rebuilt
  // digest is byte-identical to the stored one and the OG image already exists,
  // this run has nothing new to deploy. Log and exit early.
  if (args.requireComplete) {
    const storedBytes = existing ? JSON.stringify(existing, null, 2) : null;
    const newBytes = JSON.stringify(digest, null, 2);
    const ogExists = existsSync(ogPath);
    if (storedBytes === newBytes && ogExists) {
      console.log('nothing changed; already published');
      await setOutput('published', 'false');
      return;
    }
  }
```

This block reads `existing` (lifted in Task 2, the last published `<date>.json` as it was at the start of this run) and `ogPath` (already computed above in `main()`). The `digest` object is fully assembled before this point. `JSON.stringify(digest, null, 2)` uses the same serialisation as `writeIfChanged`, so the comparison is byte-faithful.

**Why this placement is correct (before `writeIfChanged`):** the gate must check `existing` before any writes happen this run. If placed after `writeIfChanged(<date>.json)`, a crash on the previous run that wrote `<date>.json` but not `latest.json` would strand `latest.json` permanently: on the next run `existing` would already equal `newBytes` (the re-computed digest is identical), the gate would fire, and `latest.json` would never be repaired. Placing the gate before any write avoids this: `existing` is always the state of `<date>.json` from before this run, so a post-crash repair run (which produces the same digest) correctly proceeds to update `latest.json`, `manifest.json`, and `index.html` before the gate would have had a chance to fire.

**Artifact-consistency invariant:** when the gate fires, nothing has been written yet this run — the early return leaves `<date>.json`, `latest.json`, `manifest.json`, and `index.html` exactly as the prior run left them. A run that passes the gate (digest differs or no stored digest) writes all artifacts in the normal sequence. The gate is a no-op when there is no stored digest yet (first publish: `existing` is null, so `storedBytes` is null, condition is false).

**Why this placement is correct (timing of setOutput):** the gate returns before `setOutput('published', 'true')` (line 350 in the current code). That output signals the GitHub Actions workflow to run the commit and deploy steps. Returning with `published=false` here satisfies the spec's requirement to "return before the commit/deploy outputs."

- [ ] **Step 4: Run the tests to confirm they pass**

Run:

```bash
node --test test/run.test.js
```

Expected: all tests pass including the two new gate tests.

- [ ] **Step 5: Run the full test suite**

Run:

```bash
npm test
```

Expected: all tests pass, no warnings.

- [ ] **Step 6: Commit**

```bash
git add pipeline/run.js test/run.test.js
git commit -m "feat: publish-only-on-change gate under --require-complete"
```

---

## Task 6: Full verification — scenarios from the spec

**Files:** none (verification only)

These five scenario runs prove all three changes work end-to-end. They all operate against the same `--out` dir so each run reads the prior run's stored digest. Use `test/fixtures` as the base (4 finished matches: ids 537327, 537328, 537330, 537331). The default `highlights.json` covers ids 537327 and 537328 (2 of 4).

- [ ] **Step 1: Prepare a clean out dir and fixtures copy**

Run:

```bash
rm -rf /tmp/mondial-scenario && mkdir /tmp/mondial-scenario
cp test/fixtures/highlights.json /tmp/mondial-scenario/highlights-full.json
cp -r test/fixtures /tmp/mondial-scenario/fixtures
```

- [ ] **Step 2: Scenario 1 — first run publishes; teaser is count-free; both finished matches have highlights**

**Fixture data note:** `test/fixtures/matches.json` has exactly 2 FINISHED matches (537327: Mexico v South Africa, 537328: Canada v Qatar). Ids 537330 and 537331 are `TIMED` (tonight's fixtures); they are NOT in `digest.matches`. The default `highlights.json` provides canonical reels for both finished matches, so both start with highlights on the very first run.

Run:

```bash
node pipeline/run.js --fixtures /tmp/mondial-scenario/fixtures --date 2026-06-12 --out /tmp/mondial-scenario/out --require-complete
```

Then inspect:

```bash
node -e "
const d = JSON.parse(require('fs').readFileSync('/tmp/mondial-scenario/out/2026-06-12.json', 'utf8'));
console.log('teaser:', d.teaser);
console.log('match count:', d.matches.length);
console.log('highlights:', d.matches.map(m => m.id + ':' + (m.highlight ? 'YES' : 'no')).join(', '));
"
```

Expected:
- `teaser` contains `2 meciuri azi-noapte, cu rezumate video` (matchCount=2, no recap count number)
- `match count` is 2 (only the FINISHED matches appear in `digest.matches`)
- both 537327 and 537328 show `YES` (both highlights are already present in the default fixture)

- [ ] **Step 3: Scenario 2 — re-run with same fixtures; gate fires because both highlights are already stored**

Run:

```bash
node pipeline/run.js --fixtures /tmp/mondial-scenario/fixtures --date 2026-06-12 --out /tmp/mondial-scenario/out --require-complete
```

Expected: output DOES contain `nothing changed; already published` — the digest is byte-identical to the stored one (both highlights were present from Scenario 1, narration is reused via prose freeze, so no fields changed). This proves the gate works for the base case.

Also verify the teaser field is byte-identical to Scenario 1:

```bash
node -e "
const d = JSON.parse(require('fs').readFileSync('/tmp/mondial-scenario/out/2026-06-12.json', 'utf8'));
console.log('teaser:', d.teaser);
"
```

Expected: same teaser string as Scenario 1.

- [ ] **Step 4: Scenario 3 — simulated outage; stored links survive, gate still fires**

Replace `highlights.json` in the fixtures dir with an empty feed:

```bash
printf '{"items":[]}' > /tmp/mondial-scenario/fixtures/highlights.json
```

Run:

```bash
node pipeline/run.js --fixtures /tmp/mondial-scenario/fixtures --date 2026-06-12 --out /tmp/mondial-scenario/out --require-complete
```

Verify:

```bash
node -e "
const d = JSON.parse(require('fs').readFileSync('/tmp/mondial-scenario/out/2026-06-12.json', 'utf8'));
console.log('highlights:', d.matches.map(m => m.id + ':' + (m.highlight ? 'YES' : 'no')).join(', '));
"
```

Expected: ids 537327 and 537328 still show `YES` — the empty-feed outage did NOT wipe the stored links (monotonic merge preserved them). The run should also log `nothing changed; already published` because the monotonic merge produced the same digest as was stored, proving that an outage neither wipes links nor re-opens the chase.

- [ ] **Step 5: Scenario 4 — extend fixtures to 4 finished matches; all 4 highlights arrive; deploys**

This scenario proves the monotonic merge and gate also work when 4 matches are finished. First, delete the accumulated out dir so the gate does not see a prior stored digest for the 4-match case:

```bash
rm -rf /tmp/mondial-scenario/out
```

Patch the fixtures copy to flip ids 537330 and 537331 from TIMED to FINISHED. **Critically, you must also patch their `utcDate` values into the 2026-06-12 night window** (`[2026-06-11 16:00 UTC, 2026-06-12 06:00 UTC)`). The original dates (`2026-06-12T19:00Z` and `2026-06-13T01:00Z`) are outside that window, so `selectDigestMatches` would exclude them from `facts.finished` regardless of status. Use `2026-06-11T21:00Z` for 537330 and `2026-06-11T23:00Z` for 537331 — both inside the window and distinct from 537327's `19:00Z` and 537328's `02:00Z`.

Edit `/tmp/mondial-scenario/fixtures/matches.json` for ids 537330 and 537331:
- Set `"status": "FINISHED"`
- Set `"utcDate": "2026-06-11T21:00Z"` (for 537330) and `"utcDate": "2026-06-11T23:00Z"` (for 537331)
- Add stub `"score": { "fullTime": { "home": 1, "away": 0 } }` to each (required by `parseMatch`)

Do NOT edit `test/fixtures/matches.json` — only the copied fixtures.

Then write a highlights feed covering all 4 matches. `recapsFor` keys by kickoff minute and country codes — the `"title"` suffix must be `on MM/DD/YYYY HH:mm UTC` matching each match's patched `utcDate` exactly, and two Country tags with the right flag codes must be present. The actual teams and kickoff times from the patched fixture are:

- 537327: Mexico (`MEX`) v South Africa (`RSA`) — `utcDate` `2026-06-11T19:00Z` → title suffix `06/11/2026 19:00 UTC`
- 537328: Canada (`CAN`) v Qatar (`QAT`) — `utcDate` `2026-06-12T02:00Z` → title suffix `06/12/2026 02:00 UTC`
- 537330: Brazil (`BRA`) v Morocco (`MAR`) — patched `utcDate` `2026-06-11T21:00Z` → title suffix `06/11/2026 21:00 UTC`
- 537331: Qatar (`QAT`) v New Zealand (`NZL`) — patched `utcDate` `2026-06-11T23:00Z` → title suffix `06/11/2026 23:00 UTC`

Check `pipeline/teams.js` for the exact flag codes used by the fixture teams if any code above is uncertain.

Write the feed:

```bash
cat > /tmp/mondial-scenario/fixtures/highlights.json << 'EOF'
{
  "items": [
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
        { "sourceCategory": "Country", "title": "Canada", "id": "CAN" },
        { "sourceCategory": "Country", "title": "Qatar", "id": "QAT" }
      ]
    },
    {
      "entryId": "braMorHighlight",
      "title": "Brazil v Morocco | Group C | FIFA World Cup 2026™ | Highlights",
      "semanticTags": [
        { "sourceCategory": "Match", "title": "Brazil v Morocco on 06/11/2026 21:00 UTC", "id": "400021445" },
        { "sourceCategory": "Country", "title": "Brazil", "id": "BRA" },
        { "sourceCategory": "Country", "title": "Morocco", "id": "MAR" }
      ]
    },
    {
      "entryId": "qatNzlHighlight",
      "title": "Qatar v New Zealand | Group D | FIFA World Cup 2026™ | Highlights",
      "semanticTags": [
        { "sourceCategory": "Match", "title": "Qatar v New Zealand on 06/11/2026 23:00 UTC", "id": "400021446" },
        { "sourceCategory": "Country", "title": "Qatar", "id": "QAT" },
        { "sourceCategory": "Country", "title": "New Zealand", "id": "NZL" }
      ]
    }
  ]
}
EOF
```

Run:

```bash
node pipeline/run.js --fixtures /tmp/mondial-scenario/fixtures --date 2026-06-12 --out /tmp/mondial-scenario/out --require-complete
```

Expected: output does NOT contain `nothing changed; already published` (first run for the 4-match case always publishes).

```bash
node -e "
const d = JSON.parse(require('fs').readFileSync('/tmp/mondial-scenario/out/2026-06-12.json', 'utf8'));
console.log('match count:', d.matches.length);
console.log('highlights:', d.matches.map(m => m.id + ':' + (m.highlight ? 'YES' : 'no')).join(', '));
"
```

Expected: `match count` is 4; all 4 matches show `YES`. If any match shows `no`, verify: (1) the utcDate in the patched fixture matches the title timestamp exactly — `2026-06-11T21:00Z` must pair with `06/11/2026 21:00 UTC` and `2026-06-11T23:00Z` with `06/11/2026 23:00 UTC`; (2) the flag codes in the feed match what `flagCode()` in `teams.js` returns for those team names; (3) the title timestamp format is exactly `MM/DD/YYYY HH:mm UTC` with no seconds; (4) the `CANONICAL_SUFFIX` regex in `highlights.js` matches (title ends with `| Highlights`).

- [ ] **Step 6: Scenario 5 — re-run after all 4 links stored; gate fires**

Run:

```bash
node pipeline/run.js --fixtures /tmp/mondial-scenario/fixtures --date 2026-06-12 --out /tmp/mondial-scenario/out --require-complete
```

Expected output contains: `nothing changed; already published`

- [ ] **Step 7: Run the full test suite one final time**

Run:

```bash
npm test
```

Expected: all tests pass, no warnings, no spurious output.

- [ ] **Step 8: Commit**

No new code changes in this task; the commit is for confirmation. If the scenario revealed any fixture data mismatch (wrong flag codes, title format), fix the corresponding `highlights.json` in the `run.test.js` fixture-copy step too and re-commit `test/run.test.js` with the correction.

---

## Self-Review: spec coverage check

**A. Teaser — count-free (`pipeline/teaser.js`):**
- `gamesLabel` drops `recapCount` — Task 1 step 3. ✓
- `matchCount > 0` appends `, cu rezumate video` with comma before `azi-noapte` — Task 1 step 3. ✓
- Exact output strings `4 meciuri azi-noapte, cu rezumate video` / `1 meci azi-noapte, cu rezumate video` / `2 meciuri azi-noapte, cu rezumate video` — Task 1 tests use synthetic matchCounts; the real fixture run produces `2 meciuri` (2 FINISHED matches). ✓
- `pauză azi-noapte` on zero matches (no clause) — Task 1 test. ✓
- `recapByMatch.size` argument removed from call site — Task 4. ✓
- Teaser stability across backfill runs is by construction (count-free + headline from prose freeze) — proved by Scenario 2 (same teaser field). ✓

**B. Monotonic highlight merge (`pipeline/run.js`):**
- `existingHighlightById` map built from `existing?.matches` — Task 3 step 4. ✓
- Merge: `recapByMatch.get(id) ?? existingHighlightById.get(id) ?? null` — Task 3 step 4. ✓
- Stored link survives an empty-map outage — Task 3 unit test + Scenario 3. ✓
- Fresh link wins over stored link (correction) — Task 3 unit test. ✓
- No stored + no fresh → `null` — Task 3 unit test. ✓
- `existing` lifted above `reNarrate` block — Task 2. ✓

**C. Publish-only-on-change gate (`pipeline/run.js`, under `--require-complete`):**
- Gate compares serialised digest byte-for-byte against stored one — Task 5 step 3. ✓
- When identical and OG image exists: logs `nothing changed; already published`, sets `published=false`, returns — Task 5 step 3. ✓
- Gate fires BEFORE `writeIfChanged(<date>.json)` so a prior partial-write crash does not strand `latest.json` — Task 5 step 3. ✓
- Gate is a no-op when no stored digest exists (first publish always deploys) — `storedBytes` is null when `existing` is null, so condition is false. ✓
- `--re-narrate` runs always deploy (prose regenerated → digest differs) — not gated because `storedBytes !== newBytes`. ✓
- Gate exercised under `--fixtures` (in-memory comparison, no network) — Scenarios 2, 3, and 5. ✓
- Scenario 2 proves the auto-stop on the minimal 2-match case; Scenario 5 proves it on the 4-match case — Task 6 steps 3 and 6. ✓

**D. No changes to:**
- `digest.yml` / `freshness-alarm.yml` — not touched. ✓
- `fetch.js` readiness gate — not touched. ✓
- `highlights.js` — not touched. ✓
- Manifest recap counts — unchanged; gate skips manifest rebuild when no-change is fine per spec. ✓

**Placeholder scan:** no TBD/TODO markers. All code blocks are complete. No type inconsistencies (the `mergeHighlight` signature is used identically in test and implementation). Scenario 4 explicitly names the correct teams, flag codes, and patched kickoff timestamps for the 4-match case; both `status` and `utcDate` are patched to put matches inside the night window; the implementer is also told to check `teams.js` if any code is uncertain. The fixture-patching step is an explicit instruction, not a vague hint.

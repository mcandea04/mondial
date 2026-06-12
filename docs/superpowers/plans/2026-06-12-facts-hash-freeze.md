# Facts-Hash Freeze Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Published digest prose is frozen unless the underlying facts change; tests never touch `site/data/`; prose can be regenerated from the phone via a prefilled GitHub issue with an optional steering note.

**Architecture:** A canonical SHA-256 over the narration input (`factsHash`) is stored in each digest JSON. On every run the hash of fresh facts is compared with the stored one: match → reuse stored prose without calling Gemini; mismatch → re-narrate. A `--re-narrate` flag forces regeneration, a `--steer` flag injects a one-shot instruction into the prompt, and a `--out` flag redirects all writes for tests. A thin issue-triggered workflow dispatches the existing digest workflow.

**Tech Stack:** Node 20 ES modules, `node:test`, `node:crypto`, GitHub Actions, `gh` CLI. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-12-facts-hash-freeze-design.md`

---

### Task 1: Canonical facts hash module

**Files:**
- Create: `pipeline/facts-hash.js`
- Test: `test/facts-hash.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/facts-hash.test.js`. The hash covers a **trimmed projection** — only the facts the prose narrates (finished match id + final score, tonight id + teams + kickoff). Standings, scorers, events, and finished-match kickoff times are deliberately excluded so an unrelated standings shift or a late scorer name does not unfreeze a published day.

The score lives on parsed matches as `score: [home, away]` (see `parseMatch` in `pipeline/fetch.js`), so the projection reads `m.score`.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factsHash } from '../pipeline/facts-hash.js';

const base = {
  date: '2026-06-12',
  finished: [
    { id: 2, home: 'Canada', away: 'Qatar', score: [4, 0], scorers: ['Davies 12'], group: 'B', utcDate: '2026-06-12T02:00:00Z' },
    { id: 1, home: 'Mexic', away: 'Africa de Sud', score: [1, 0], scorers: ['Lozano 88'], group: 'A', utcDate: '2026-06-11T19:00:00Z' },
  ],
  tonight: [{ id: 3, home: 'Brazilia', away: 'Maroc', kickoffEEST: '21:00', utcDate: '2026-06-12T18:00:00Z' }],
  standings: [
    { name: 'B', table: [{ team: 'Canada', pts: 3 }] },
    { name: 'A', table: [{ team: 'Mexic', pts: 3 }] },
  ],
};

test('hash is stable for identical input', () => {
  assert.equal(factsHash(base), factsHash(structuredClone(base)));
});

test('object key order does not change the hash', () => {
  const reordered = structuredClone(base);
  reordered.finished[1] = { utcDate: '2026-06-11T19:00:00Z', group: 'A', scorers: ['Lozano 88'], score: [1, 0], away: 'Africa de Sud', home: 'Mexic', id: 1 };
  assert.equal(factsHash(base), factsHash(reordered));
});

test('array order of matches does not change the hash', () => {
  const reordered = structuredClone(base);
  reordered.finished.reverse();
  assert.equal(factsHash(base), factsHash(reordered));
});

test('a changed score changes the hash', () => {
  const corrected = structuredClone(base);
  corrected.finished[0].score = [4, 1];
  assert.notEqual(factsHash(base), factsHash(corrected));
});

test('a changed standings table does NOT change the hash', () => {
  const shifted = structuredClone(base);
  shifted.standings[0].table[0].pts = 6;
  assert.equal(factsHash(base), factsHash(shifted));
});

test('a late scorer name does NOT change the hash', () => {
  const withScorer = structuredClone(base);
  withScorer.finished[0].scorers.push('Buchanan 90+2');
  assert.equal(factsHash(base), factsHash(withScorer));
});

test('a changed tonight kickoff changes the hash', () => {
  const moved = structuredClone(base);
  moved.tonight[0].kickoffEEST = '22:00';
  assert.notEqual(factsHash(base), factsHash(moved));
});

test('a changed date changes the hash', () => {
  assert.notEqual(factsHash(base), factsHash({ ...base, date: '2026-06-13' }));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/facts-hash.test.js`
Expected: FAIL — `Cannot find module '../pipeline/facts-hash.js'`

- [ ] **Step 3: Write the implementation**

Create `pipeline/facts-hash.js`:

```js
/**
 * Stable identity for the prose a digest narrates. Two runs whose narrated
 * facts match produce the same hash — regardless of key order, array order, or
 * volatile fields the prose never mentions (full standings, scorer lists, event
 * feeds, finished-match kickoff times). This lets the pipeline tell "facts
 * unchanged, reuse prose" from "facts changed, re-narrate" without unfreezing a
 * published day every time an unrelated group's table shifts.
 */

import { createHash } from 'node:crypto';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = canonicalize(value[key]);
    return sorted;
  }
  return value;
}

const byId = (a, b) => (a.id ?? 0) - (b.id ?? 0);

/** The narrated-facts projection: only what the headline/summary/pills depend on. */
function project({ date, finished, tonight }) {
  return {
    date,
    finished: [...finished]
      .sort(byId)
      .map((m) => ({ id: m.id, score: m.score })),
    tonight: [...tonight]
      .sort(byId)
      .map((m) => ({ id: m.id, home: m.home, away: m.away, kickoffEEST: m.kickoffEEST })),
  };
}

export function factsHash(facts) {
  const canonical = canonicalize(project(facts));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/facts-hash.test.js`
Expected: 8 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add pipeline/facts-hash.js test/facts-hash.test.js
git commit -m "Add canonical facts hash for digest identity"
```

---

### Task 2: Prose reuse module

**Files:**
- Create: `pipeline/prose-reuse.js`
- Test: `test/prose-reuse.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/prose-reuse.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reuseNarration } from '../pipeline/prose-reuse.js';

const stored = {
  headline: 'Bosnia sperie Canada ca un urs',
  summary: 'Două propoziții. Exact două.',
  matches: [{ id: 1, home: 'Bosnia', away: 'Canada', pill: 'Pastila 1', drama: 4 }],
  tonight: [{ id: 3, home: 'Brazilia', away: 'Maroc', alarm: 'stai treaz', why: 'Motivul' }],
};

const facts = {
  finished: [{ id: 1, home: 'Bosnia', away: 'Canada' }],
  tonight: [{ id: 3, home: 'Brazilia', away: 'Maroc' }],
};

test('rebuilds narration from a stored digest', () => {
  const narration = reuseNarration(stored, facts);
  assert.deepEqual(narration, {
    headline: 'Bosnia sperie Canada ca un urs',
    summary: 'Două propoziții. Exact două.',
    matches: [{ id: 1, pill: 'Pastila 1', drama: 4 }],
    tonight: [{ id: 3, alarm: 'stai treaz', why: 'Motivul' }],
  });
});

test('falls back to home+away matching for legacy tonight entries without id', () => {
  const legacy = structuredClone(stored);
  delete legacy.tonight[0].id;
  const narration = reuseNarration(legacy, facts);
  assert.deepEqual(narration.tonight, [{ id: 3, alarm: 'stai treaz', why: 'Motivul' }]);
});

test('returns null when a finished match has no stored prose', () => {
  const moreFacts = structuredClone(facts);
  moreFacts.finished.push({ id: 2, home: 'Mexic', away: 'Qatar' });
  assert.equal(reuseNarration(stored, moreFacts), null);
});

test('returns null when a tonight fixture has no stored prose', () => {
  const moreFacts = structuredClone(facts);
  moreFacts.tonight.push({ id: 9, home: 'Franța', away: 'Norvegia' });
  assert.equal(reuseNarration(stored, moreFacts), null);
});

test('returns null for a digest without headline or summary', () => {
  assert.equal(reuseNarration({ matches: [], tonight: [] }, facts), null);
  assert.equal(reuseNarration(null, facts), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/prose-reuse.test.js`
Expected: FAIL — `Cannot find module '../pipeline/prose-reuse.js'`

- [ ] **Step 3: Write the implementation**

Create `pipeline/prose-reuse.js`:

```js
/**
 * Rebuilds the narration object from a previously published digest so a run
 * can skip the Gemini call when facts are unchanged.
 *
 * Tonight entries are matched by id; digests written before ids were stored
 * fall back to home+away matching. Returns null when the stored digest cannot
 * cover the current facts — the caller then re-narrates.
 */
export function reuseNarration(stored, facts) {
  if (!stored?.headline || !stored?.summary) return null;

  const storedMatches = new Map((stored.matches ?? []).map((m) => [m.id, m]));
  const matches = [];
  for (const m of facts.finished) {
    const s = storedMatches.get(m.id);
    if (!s?.pill) return null;
    matches.push({ id: m.id, pill: s.pill, drama: s.drama ?? 1 });
  }

  const tonightById = new Map();
  const tonightByTeams = new Map();
  for (const t of stored.tonight ?? []) {
    if (t.id != null) tonightById.set(t.id, t);
    tonightByTeams.set(`${t.home}|${t.away}`, t);
  }
  const tonight = [];
  for (const f of facts.tonight) {
    const s = tonightById.get(f.id) ?? tonightByTeams.get(`${f.home}|${f.away}`);
    if (!s?.why) return null;
    tonight.push({ id: f.id, alarm: s.alarm, why: s.why });
  }

  return { headline: stored.headline, summary: stored.summary, matches, tonight };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/prose-reuse.test.js`
Expected: 5 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add pipeline/prose-reuse.js test/prose-reuse.test.js
git commit -m "Add prose reuse from stored digests"
```

---

### Task 3: `--out` isolation and new CLI flags in run.js

**Files:**
- Modify: `pipeline/run.js`
- Test: `test/run.test.js` (new)

- [ ] **Step 1: Write the failing integration test**

Create `test/run.test.js`. The helper copies the fixtures into a temp dir so later tasks can mutate them between runs; it is shared by Tasks 4 and 5.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATE = '2026-06-12';

export function freshDirs() {
  const fixtures = mkdtempSync(path.join(tmpdir(), 'mondial-fixtures-'));
  cpSync(path.join(ROOT, 'test', 'fixtures'), fixtures, { recursive: true });
  const out = mkdtempSync(path.join(tmpdir(), 'mondial-out-'));
  return { fixtures, out };
}

export function runPipeline({ fixtures, out, extra = [] }) {
  return execFileSync(
    'node',
    ['pipeline/run.js', '--fixtures', fixtures, '--date', DATE, '--out', out, ...extra],
    { cwd: ROOT, encoding: 'utf8' },
  );
}

export function readDigest(out) {
  return JSON.parse(readFileSync(path.join(out, `${DATE}.json`), 'utf8'));
}

test('--out redirects all writes and leaves site/data untouched', () => {
  const { fixtures, out } = freshDirs();
  const siteDataPath = path.join(ROOT, 'site', 'data', `${DATE}.json`);
  const before = existsSync(siteDataPath) ? readFileSync(siteDataPath, 'utf8') : null;
  const indexBefore = readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf8');

  runPipeline({ fixtures, out });

  assert.ok(existsSync(path.join(out, `${DATE}.json`)), 'digest written to out dir');
  assert.ok(existsSync(path.join(out, 'latest.json')), 'latest.json written to out dir');
  assert.ok(existsSync(path.join(out, 'manifest.json')), 'manifest written to out dir');
  assert.ok(existsSync(path.join(out, 'og', `${DATE}.png`)), 'og image written to out dir');

  const after = existsSync(siteDataPath) ? readFileSync(siteDataPath, 'utf8') : null;
  assert.equal(after, before, 'site/data digest unchanged');
  assert.equal(readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf8'), indexBefore, 'index.html unchanged');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/run.test.js`
Expected: FAIL — `Unknown argument: --out` (thrown by `parseArgs` in the subprocess, surfaced as non-zero exit)

- [ ] **Step 3: Implement flag parsing and out-dir wiring**

In `pipeline/run.js`:

Replace `parseArgs` with:

```js
function parseArgs(argv) {
  const args = { date: null, fixtures: null, requireComplete: false, out: null, reNarrate: false, steer: null };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--date') args.date = argv[++i];
    else if (argv[i] === '--fixtures') args.fixtures = argv[++i];
    else if (argv[i] === '--require-complete') args.requireComplete = true;
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--re-narrate') args.reNarrate = true;
    else if (argv[i] === '--steer') args.steer = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}
```

In `main()`, right after `const date = ...`, resolve the output directory (fixtures runs default to `tmp/out/` so a local test can never touch published data):

```js
  const dataDir = args.out
    ? path.resolve(args.out)
    : args.fixtures
      ? path.join(ROOT, 'tmp', 'out')
      : DATA_DIR;
```

Then thread `dataDir` through the function:
- `recentProseBefore(date)` becomes `recentProseBefore(dataDir, date)`; inside it, replace both uses of `DATA_DIR` with the new `dataDir` parameter. Guard the `readdir` against the directory not existing yet:

```js
async function recentProseBefore(dataDir, date, days = 3) {
  if (!existsSync(dataDir)) return [];
  const files = (await readdir(dataDir))
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .map((name) => name.replace('.json', ''))
    .filter((d) => d < date)
    .sort()
    .slice(-days);

  const prose = [];
  for (const d of files) {
    const digest = await readJson(path.join(dataDir, `${d}.json`));
    prose.push(digest.headline, digest.summary);
    for (const m of digest.matches ?? []) prose.push(m.pill);
    for (const t of digest.tonight ?? []) prose.push(t.why);
  }
  return prose.filter(Boolean);
}
```

- In `main()`, replace every `DATA_DIR` with `dataDir` (the `mkdir`, the three `writeFile` calls, the manifest `readdir`). Call site: `const recentProse = args.fixtures ? [] : await recentProseBefore(dataDir, date);`
- Wrap the `index.html` block in a guard — when `--out` is active the page mutation is skipped:

```js
  if (!args.out && !args.fixtures) {
    const indexPath = path.join(SITE_DIR, 'index.html');
    const html = await readFile(indexPath, 'utf8');
    await writeFile(
      indexPath,
      injectOgTags(html, {
        title: narration.headline,
        description: narration.summary,
        image: `${siteUrl}data/og/${date}.png`,
        url: siteUrl,
      }),
    );
  }
```

(The `!args.fixtures` guard also fixes the pre-existing leak where a fixtures run without `--out` rewrote the live `index.html`.)

- Update the usage comment at the top of the file to document `--out`, `--re-narrate`, and `--steer`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/run.test.js`
Expected: PASS (1 test)

- [ ] **Step 5: Ignore the local default output dir**

Append `tmp/` to `.gitignore`:

```bash
printf 'tmp/\n' >> .gitignore
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: all tests pass (facts-hash, prose-reuse, run, standings, fetch)

- [ ] **Step 7: Commit**

```bash
git add pipeline/run.js test/run.test.js .gitignore
git commit -m "Add --out isolation and new CLI flags to the pipeline"
```

---

### Task 4: Freeze logic — hash compare, reuse, write-if-changed

**Files:**
- Modify: `pipeline/run.js`
- Test: `test/run.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/run.test.js`:

```js
function setCannedHeadline(fixtures, headline) {
  const cannedPath = path.join(fixtures, 'narration.json');
  const canned = JSON.parse(readFileSync(cannedPath, 'utf8'));
  canned.headline = headline;
  writeFileSync(cannedPath, JSON.stringify(canned, null, 2));
}

test('same facts: second run reuses prose and ignores new narration', () => {
  const { fixtures, out } = freshDirs();
  runPipeline({ fixtures, out });
  const first = readDigest(out);
  assert.ok(first.factsHash, 'factsHash stored in digest');
  assert.ok(first.tonight.every((t) => t.id != null), 'tonight entries carry ids');

  setCannedHeadline(fixtures, 'Proză nouă care NU trebuie folosită');
  const log = runPipeline({ fixtures, out });
  assert.match(log, /facts unchanged, prose reused/);
  const second = readDigest(out);
  // Freeze guarantee is prose-unchanged, not byte-identical.
  assert.equal(second.headline, first.headline);
  assert.equal(second.summary, first.summary);
  assert.deepEqual(second.matches.map((m) => m.pill), first.matches.map((m) => m.pill));
  assert.deepEqual(second.tonight.map((t) => t.why), first.tonight.map((t) => t.why));
});

test('--re-narrate forces fresh prose even when facts are unchanged', () => {
  const { fixtures, out } = freshDirs();
  runPipeline({ fixtures, out });

  setCannedHeadline(fixtures, 'Proză regenerată la cerere');
  runPipeline({ fixtures, out, extra: ['--re-narrate'] });
  assert.equal(readDigest(out).headline, 'Proză regenerată la cerere');
});

test('changed facts re-narrate automatically', () => {
  const { fixtures, out } = freshDirs();
  runPipeline({ fixtures, out });
  const first = readDigest(out);

  const matchesPath = path.join(fixtures, 'matches.json');
  const matches = JSON.parse(readFileSync(matchesPath, 'utf8'));
  const finished = matches.matches.find((m) => m.status === 'FINISHED');
  finished.score.fullTime.home += 1;
  writeFileSync(matchesPath, JSON.stringify(matches, null, 2));
  setCannedHeadline(fixtures, 'Proză nouă după corecția scorului');

  runPipeline({ fixtures, out });
  const second = readDigest(out);
  assert.notEqual(second.factsHash, first.factsHash);
  assert.equal(second.headline, 'Proză nouă după corecția scorului');
});

test('legacy digest without factsHash is trusted: prose reused, hash stamped', () => {
  const { fixtures, out } = freshDirs();
  runPipeline({ fixtures, out });
  const digestPath = path.join(out, `${DATE}.json`);
  const legacy = JSON.parse(readFileSync(digestPath, 'utf8'));
  const expectedHash = legacy.factsHash;
  delete legacy.factsHash;
  writeFileSync(digestPath, JSON.stringify(legacy, null, 2));

  setCannedHeadline(fixtures, 'Proză nouă care NU trebuie folosită');
  runPipeline({ fixtures, out });
  const after = readDigest(out);
  assert.equal(after.headline, legacy.headline);
  assert.equal(after.factsHash, expectedHash);
});
```

(The fixture stores the score under `score.fullTime.home` — football-data.org v4 format — and `parseMatch` projects it to `score: [home, away]`. The test mutates the raw fixture, which is re-parsed, so the projected score and therefore the hash change.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/run.test.js`
Expected: the four new tests FAIL (no `factsHash` in output, reuse log line missing)

- [ ] **Step 3: Implement the freeze logic**

In `pipeline/run.js`:

Add imports:

```js
import { factsHash } from './facts-hash.js';
import { reuseNarration } from './prose-reuse.js';
```

Add two helpers next to `readJson`:

```js
async function readJsonOrNull(filePath) {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

/** Writes only when content differs from what is on disk. */
async function writeIfChanged(filePath, content) {
  try {
    const current = await readFile(filePath);
    if (Buffer.compare(current, Buffer.from(content)) === 0) return;
  } catch {
    // missing file: fall through to write
  }
  await writeFile(filePath, content);
}
```

In `main()`, replace the narration block (from `const recentProse = ...` down to and including the `const narration = await getNarration(...)` call) with:

```js
  const factsForNarration = { date, finished: facts.finished, tonight: facts.tonight, standings };
  const hash = factsHash(factsForNarration);

  // Freeze: when the stored digest was built from the same facts, reuse its
  // prose instead of regenerating. A stored digest without factsHash predates
  // this mechanism and is trusted as-is (the hash gets stamped on rewrite).
  let narration = null;
  let reused = false;
  if (!args.reNarrate) {
    const existing = await readJsonOrNull(path.join(dataDir, `${date}.json`));
    if (existing && (!existing.factsHash || existing.factsHash === hash)) {
      narration = reuseNarration(existing, facts);
      reused = narration != null;
    }
  }

  if (reused) {
    console.log('facts unchanged, prose reused');
  } else {
    const recentProse = args.fixtures ? [] : await recentProseBefore(dataDir, date);
    narration = await getNarration(factsForNarration, {
      fixtures: args.fixtures,
      recentProse,
      steer: args.steer,
    });
  }
```

(`steer` is plumbed into `getNarration` here but only used from Task 6 onward; until then the extra option is ignored.)

In the `digest` object literal, add the hash and the tonight ids:

```js
  const digest = {
    date,
    factsHash: hash,
    headline: narration.headline,
    summary: narration.summary,
    matches: facts.finished.map((m) => ({
      ...m,
      pill: narrationByMatch.get(m.id)?.pill ?? '',
      drama: narrationByMatch.get(m.id)?.drama ?? 1,
    })),
    groups: standings.filter((g) => groupsThatPlayed.has(g.name)),
    tonight: facts.tonight.map((m) => ({
      id: m.id,
      home: m.home,
      away: m.away,
      kickoffEEST: m.kickoffEEST ?? kickoffEEST(m.utcDate),
      alarm: narrationByFixture.get(m.id)?.alarm ?? 'citești dimineața',
      why: narrationByFixture.get(m.id)?.why ?? '',
    })),
    teaser: buildTeaser({
      headline: narration.headline,
      matchCount: facts.finished.length,
      siteUrl,
    }),
  };
```

Replace the write block: OG image renders only when needed, JSON writes go through `writeIfChanged`:

```js
  await mkdir(path.join(dataDir, 'og'), { recursive: true });

  const ogPath = path.join(dataDir, 'og', `${date}.png`);
  if (!reused || !existsSync(ogPath)) {
    const png = await renderOgImage({
      date,
      headline: narration.headline,
      matches: digest.matches,
    });
    await writeIfChanged(ogPath, png);
  }

  await writeIfChanged(path.join(dataDir, `${date}.json`), JSON.stringify(digest, null, 2));
  await writeIfChanged(path.join(dataDir, 'latest.json'), JSON.stringify(digest, null, 2));
```

(The `latest.json` line changes again in Task 5; the manifest write below stays as `writeFile` → switch it to `writeIfChanged` too.)

Move the `renderOgImage` call out of its old position (it previously ran unconditionally before the writes).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/run.test.js`
Expected: 5 pass (isolation + 4 freeze tests)

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add pipeline/run.js test/run.test.js
git commit -m "Freeze published prose behind a facts hash"
```

---

### Task 5: `latest.json` guard

**Files:**
- Modify: `pipeline/run.js`
- Test: `test/run.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/run.test.js`:

```js
test('a backfill run for an older date does not clobber a newer latest.json', () => {
  const { fixtures, out } = freshDirs();
  runPipeline({ fixtures, out });
  const newer = { ...readDigest(out), date: '2026-06-13' };
  writeFileSync(path.join(out, 'latest.json'), JSON.stringify(newer, null, 2));

  runPipeline({ fixtures, out, extra: ['--re-narrate'] });
  const latest = JSON.parse(readFileSync(path.join(out, 'latest.json'), 'utf8'));
  assert.equal(latest.date, '2026-06-13');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/run.test.js`
Expected: the new test FAILS — `latest.date` is `2026-06-12`

- [ ] **Step 3: Implement the guard**

In `main()`, replace the `latest.json` write with:

```js
  const existingLatest = await readJsonOrNull(path.join(dataDir, 'latest.json'));
  if (!existingLatest?.date || existingLatest.date <= date) {
    await writeIfChanged(path.join(dataDir, 'latest.json'), JSON.stringify(digest, null, 2));
  } else {
    console.log(`latest.json kept at ${existingLatest.date} (newer than ${date})`);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/run.test.js`
Expected: 6 pass

- [ ] **Step 5: Commit**

```bash
git add pipeline/run.js test/run.test.js
git commit -m "Keep latest.json pinned to the newest digest date"
```

---

### Task 6: `--steer` plumbing into the narration prompt

**Files:**
- Modify: `pipeline/narrate.js`, `pipeline/run.js`
- Test: `test/narrate.test.js` (new)

- [ ] **Step 1: Write the failing tests**

Create `test/narrate.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUserMessage } from '../pipeline/narrate.js';

const facts = { date: '2026-06-12', finished: [], tonight: [], standings: [] };

test('steer note is appended to the prompt', () => {
  const message = buildUserMessage(facts, [], 'mai puține metafore cu urși');
  assert.match(message, /NOTĂ DE LA EDITOR/);
  assert.match(message, /mai puține metafore cu urși/);
});

test('without steer the prompt is unchanged', () => {
  const message = buildUserMessage(facts, []);
  assert.doesNotMatch(message, /NOTĂ DE LA EDITOR/);
});

test('steer combines with recent prose avoidance', () => {
  const message = buildUserMessage(facts, ['glumă veche'], 'fii mai scurt');
  assert.match(message, /glumă veche/);
  assert.match(message, /fii mai scurt/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/narrate.test.js`
Expected: FAIL — `buildUserMessage` is not exported

- [ ] **Step 3: Implement**

In `pipeline/narrate.js`, export `buildUserMessage` and add the steer block:

```js
/**
 * Builds the user message: the day's facts, the previous days' prose to avoid
 * recycling jokes, and an optional one-shot steering note from the editor.
 */
export function buildUserMessage(facts, recentProse, steer) {
  let message = `FAPTELE DE AZI (JSON):\n${JSON.stringify(facts, null, 2)}`;
  if (recentProse?.length) {
    const avoid = recentProse.map((line) => `- ${line}`).join('\n');
    message += `

TEXTE DIN ZILELE TRECUTE — NU le reutiliza. Evită aceleași glume, metafore și imagini
(de ex. „brutarii", „masochism matinal", aceeași construcție de titlu). Caută unghiuri noi:
${avoid}`;
  }
  if (steer) {
    message += `

NOTĂ DE LA EDITOR (se aplică doar la această regenerare): ${steer}`;
  }
  return message;
}
```

Update the `narrate` signature and call:

```js
export async function narrate(facts, { apiKey, model = DEFAULT_MODEL, recentProse = [], steer = null } = {}) {
  const userMessage = buildUserMessage(facts, recentProse, steer);
```

In `pipeline/run.js`, pass steer through `getNarration` (the call site already passes it from Task 4):

```js
async function getNarration(facts, { fixtures, recentProse, steer }) {
  if (fixtures) {
    const cannedPath = path.join(fixtures, 'narration.json');
    if (existsSync(cannedPath)) return readJson(cannedPath);
  }
  return narrate(facts, {
    apiKey: requireEnv('GEMINI_API_KEY'),
    model: process.env.GEMINI_MODEL || undefined,
    recentProse,
    steer,
  });
}
```

And sanitize the raw flag value in `main()` right after `parseArgs` — the issue-body placeholder arrives as an HTML comment and must not become a steering note, and an empty workflow input must mean "no steer":

```js
  const steer = (args.steer ?? '').replace(/<!--[\s\S]*?-->/g, '').trim() || null;
```

Then use `steer` (the sanitized constant) instead of `args.steer` in the `getNarration` call from Task 4.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/narrate.test.js`
Expected: 3 pass

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add pipeline/narrate.js pipeline/run.js test/narrate.test.js
git commit -m "Add one-shot steering note to narration"
```

---

### Task 7: digest.yml — `steer` input, force-implies-renarrate, email-on-commit, push rebase

**Files:**
- Modify: `.github/workflows/digest.yml`

The `force` input already exists. We do NOT add a separate `re_narrate` checkbox (independent booleans created the silently-swallowed-re-narrate trap). `force=true` now means "bypass the readiness gate **and** re-narrate." We add one `steer` string input, make the build pass `--re-narrate` whenever forced, capture whether a commit actually happened, gate the email on that, and rebase before push.

- [ ] **Step 1: Add the steer workflow_dispatch input**

In the `workflow_dispatch.inputs` block, after the existing `force` input:

```yaml
      steer:
        description: "One-shot steering note for the narration (optional)"
        type: string
        default: ""
```

- [ ] **Step 2: Pass force→--re-narrate and steer to the pipeline**

Replace the `Build digest` step's `run:` block with (steer travels via `env:`, never interpolated into the script body):

```yaml
        run: |
          if [ "${{ github.event_name }}" = "workflow_dispatch" ] && [ "${{ inputs.force }}" = "true" ]; then
            node pipeline/run.js --re-narrate --steer "$STEER"
            echo "published=true" >> "$GITHUB_OUTPUT"
          else
            node pipeline/run.js --require-complete --steer "$STEER"
          fi
```

Add to that step's `env:` block:

```yaml
          STEER: ${{ inputs.steer }}
```

(On scheduled runs `inputs.steer` is empty; `--steer ""` is sanitized to null by run.js. A scheduled run never passes `--re-narrate`, so it reuses frozen prose when facts are unchanged.)

- [ ] **Step 3: Capture whether a commit happened, and rebase before push**

Give the commit step an `id` and emit a `committed` output. Rebase before pushing so a run queued behind another (phone re-narrate behind a scheduled poll) lands on top instead of failing on non-fast-forward. Replace the `Commit digest data` step with:

```yaml
      - name: Commit digest data
        id: commit
        if: steps.build.outputs.published == 'true'
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add site/data site/index.html
          if git diff --cached --quiet; then
            echo "Nothing to commit"
            echo "committed=false" >> "$GITHUB_OUTPUT"
          else
            git commit -m "digest: ${{ steps.build.outputs.date }}"
            git pull --rebase origin main
            git push
            echo "committed=true" >> "$GITHUB_OUTPUT"
          fi
```

- [ ] **Step 4: Gate the email on a real commit**

Change the `Email digest ready` step's `if:` from `steps.build.outputs.published == 'true'` to:

```yaml
        if: steps.commit.outputs.committed == 'true'
```

(Deploy steps keep their `published == 'true'` gate, so a restore/no-op forced run still redeploys the restored page without re-emailing the group.)

- [ ] **Step 5: Add the regenerate link to the email body**

In the `Email digest ready` step, extend the `body:` to:

```yaml
          body: |
            ${{ steps.build.outputs.headline }}

            ${{ steps.build.outputs.match_count }} meciuri azi-noapte.

            Citește digestul: https://mcandea04.github.io/mondial/

            Nu-ți place proza? Regenerează: https://github.com/mcandea04/mondial/issues/new?title=re-narrate&labels=re-narrate&body=%3C%21--%20scrie%20aici%2C%20op%C8%9Bional%2C%20ce%20vrei%20schimbat%20la%20ton%20sau%20glume%20--%3E
```

(The `body` param decodes to `<!-- scrie aici, opțional, ce vrei schimbat la ton sau glume -->` — an HTML comment, stripped by run.js if submitted untouched.)

- [ ] **Step 6: Validate the YAML**

Run: `npx --yes js-yaml .github/workflows/digest.yml > /dev/null && echo OK`
Expected: `OK`

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/digest.yml
git commit -m "Fold re-narrate into force, gate email on commit, rebase before push"
```

---

### Task 8: Issue-triggered re-narration workflow

**Files:**
- Create: `.github/workflows/re-narrate.yml`

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/re-narrate.yml`:

```yaml
name: Re-narrate digest

# Thin trigger: an issue labeled "re-narrate" opened by the repo owner
# dispatches the digest workflow with force=true (which implies re-narration)
# and the issue body as a one-shot steering note. The fresh digest email is the
# confirmation.

on:
  issues:
    types: [opened]

permissions:
  issues: write
  actions: write

jobs:
  trigger:
    if: >
      contains(github.event.issue.labels.*.name, 're-narrate') &&
      github.event.issue.user.login == 'mcandea04'
    runs-on: ubuntu-latest
    steps:
      - name: Dispatch digest workflow
        env:
          GH_TOKEN: ${{ github.token }}
          # Issue body must travel via env, never inline in the script:
          # direct interpolation of issue content into `run:` is shell injection.
          STEER: ${{ github.event.issue.body }}
        run: |
          gh workflow run digest.yml --repo "$GITHUB_REPOSITORY" \
            -f force=true -f steer="$STEER"

      - name: Confirm and close issue
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh issue comment "${{ github.event.issue.number }}" --repo "$GITHUB_REPOSITORY" \
            --body "Regenerare pornită — vei primi un email nou cu titlul proaspăt. Progres: https://github.com/$GITHUB_REPOSITORY/actions/workflows/digest.yml"
          gh issue close "${{ github.event.issue.number }}" --repo "$GITHUB_REPOSITORY"
```

Notes for the implementer:
- `workflow_dispatch` (and `repository_dispatch`) are the documented exception to GitHub's "events from the default `GITHUB_TOKEN` don't create new workflow runs" rule — they always create runs. So this dispatch works with the default `github.token`; no PAT needed. (Verified against GitHub docs: "workflow_dispatch and repository_dispatch events always create workflow runs.")
- The author check plus the label check both must hold; anyone else's issue (or an unlabeled one) makes the job skip entirely.

- [ ] **Step 2: Validate the YAML**

Run: `npx --yes js-yaml .github/workflows/re-narrate.yml > /dev/null && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/re-narrate.yml
git commit -m "Add issue-triggered remote re-narration"
```

---

### Task 9: Label, merge, and live verification

**Files:** none (operations)

- [ ] **Step 1: Create the label** (idempotent)

```bash
gh label create re-narrate --repo mcandea04/mondial --color FBCA04 --description "Trigger prose regeneration" || true
```

- [ ] **Step 2: Full local suite**

Run: `npm test`
Expected: all pass, no warnings

- [ ] **Step 3: Scenario layer 2 — live Gemini, no publish**

With `.env` containing real keys, from the repo root:

```bash
node pipeline/run.js --re-narrate --steer "păstrează tonul, dar fii mai concis" --out tmp/live-check
ls tmp/live-check/*.json && head -40 tmp/live-check/2026-*.json
```

Expected: regenerated Romanian prose visible in the tmp file; `git status` shows `site/` untouched.

- [ ] **Step 4: Push the branch and open the PR**

```bash
git push -u origin HEAD
gh pr create --fill
```

Merge after review. The remaining steps run against `main` after merge.

- [ ] **Step 5: Scenario layer 3 — full remote E2E (once)**

From the phone (or browser): open
`https://github.com/mcandea04/mondial/issues/new?title=re-narrate&labels=re-narrate&body=test%20regenerare`
and submit. Verify, in order:
1. The `Re-narrate digest` workflow run appears and the issue is commented + closed.
2. A `Daily digest` run starts (dispatched with `force=true`).
3. A new digest commit lands, the page shows new prose, a fresh email arrives.

Negative checks: an issue **without** the label must not trigger the workflow (job skipped).

- [ ] **Step 6: Restore today's prose**

```bash
git pull
git revert <digest-commit-sha> --no-edit
git push
gh workflow run digest.yml -f force=true
```

Expected: the forced run logs `facts unchanged, prose reused`. The restored bytes match HEAD, so `committed=false` → no commit and no email (the group is not re-notified), but the deploy steps still run and redeploy the restored content.

---

## Execution notes

- Tasks 1, 2, 6 are pure unit work; Tasks 3-5 build on each other inside `run.js` and must run in order.
- Tasks 7-8 are YAML-only and can be done in either order after Task 6.
- Task 9 step 5+ touches the live site once and ends with the documented restore.

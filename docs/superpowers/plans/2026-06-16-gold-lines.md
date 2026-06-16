# Gold-line Compounding Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the narrator voice by example — a hand-blessed `gold.json` of lines the owner loved, injected as few-shot taste on every run, grown one morning at a time through the existing email→issue lever, so each course-correction compounds instead of evaporating.

**Architecture:** A new `pipeline/gold.js` owns parse/load/append of gold lines. `buildUserMessage` (in `narration-core.js`) gains a `gold` argument that appends a "EXEMPLE DE TON REUȘIT" block — the positive mirror of the existing avoid-list. `run.js` loads `gold.json`, subtracts gold texts from the avoid-list, and threads gold through every narrator path. A `gold` job in `re-narrate.yml` appends a promoted line, pushes, then dispatches the existing `digest.yml` to re-narrate-and-deploy. A small `SYSTEM_PROMPT` fix repairs the 2026-06-16 tonight-line regression.

**Tech Stack:** Node 20 ESM, `node --test`, zod (already present), GitHub Actions, Gemini/Claude narration engines.

**Deviation from spec (deliberate, flagged):** The spec §3 describes "one self-contained job, no second dispatch." Implemented instead as *append+push then dispatch `digest.yml`*, because the digest workflow owns the GitHub Pages deploy (`upload-pages-artifact` + `deploy-pages`) and email; a self-contained gold job that only committed `site/data` would leave the live site stale until the next nightly. The doubt-panel races are still closed: `re-narrate.yml` joins `concurrency: digest` (no push collision with the nightly) and the gold push completes before the dispatch (the dispatched checkout sees the new gold). Dedup keeps a retried issue idempotent. Same guarantees, reuses deploy+email, far less YAML duplication.

---

## File Structure

- **Create** `pipeline/gold.js` — gold storage logic: `loadGold`, `parseGoldIssue`, `appendGold`, a `capPerField` helper, and an `add-from-issue` CLI. Single responsibility: read/parse/write the gold archive.
- **Create** `test/gold.test.js` — unit tests for the above.
- **Create** `pipeline/gold.json` — the committed gold archive (written by the seed session, Task 9).
- **Modify** `pipeline/narration-core.js` — `buildUserMessage` gains a `gold` param + injection block; `buildRewriteSystemPrompt` gains a gold-target reminder; `SYSTEM_PROMPT` rule 5 regression fix.
- **Modify** `pipeline/narrate.js` — `narrate()` gains a `gold` option, passed to `buildUserMessage`.
- **Modify** `pipeline/run.js` — load gold, subtract from `recentProse`, thread `gold` through `getNarration` / `geminiNarration` / both `buildUserMessage` calls.
- **Modify** `test/narrate.test.js`, `test/narrator-select.test.js` — assert gold reaches the message.
- **Modify** `.github/workflows/re-narrate.yml` — add the `gold` job + `concurrency: digest`.
- **Modify** `.github/workflows/digest.yml` — second email link (gold); email even when a forced run produced no change.

---

## Task 1: `gold.js` — load, parse, append (pure functions)

**Files:**
- Create: `pipeline/gold.js`
- Test: `test/gold.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
// test/gold.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadGold, parseGoldIssue, appendGold } from '../pipeline/gold.js';

async function withTempFile(contents, fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'gold-'));
  const file = path.join(dir, 'gold.json');
  if (contents != null) await writeFile(file, contents);
  try {
    return await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('parseGoldIssue: exact field prefix is honored', () => {
  const out = parseGoldIssue('headline: Spania a tras de 27 de ori și tot nimic');
  assert.deepEqual(out, [{ field: 'headline', text: 'Spania a tras de 27 de ori și tot nimic' }]);
});

test('parseGoldIssue: prefix match is case-insensitive', () => {
  const out = parseGoldIssue('PILL: ceva');
  assert.deepEqual(out, [{ field: 'pill', text: 'ceva' }]);
});

test('parseGoldIssue: a bare line defaults to pill', () => {
  const out = parseGoldIssue('Portarul a scos nouă mingi fără să transpire');
  assert.deepEqual(out, [{ field: 'pill', text: 'Portarul a scos nouă mingi fără să transpire' }]);
});

test('parseGoldIssue: a clock time is not mistaken for a prefix', () => {
  const out = parseGoldIssue('Olanda contra Japoniei la 23:00, două echipe care abia intră');
  assert.deepEqual(out, [{ field: 'pill', text: 'Olanda contra Japoniei la 23:00, două echipe care abia intră' }]);
});

test('parseGoldIssue: an unknown word prefix stays whole as pill', () => {
  const out = parseGoldIssue('Spania: campioana posesiei sterile');
  assert.deepEqual(out, [{ field: 'pill', text: 'Spania: campioana posesiei sterile' }]);
});

test('parseGoldIssue: a valid prefix with empty text is skipped', () => {
  assert.deepEqual(parseGoldIssue('pill:   '), []);
});

test('parseGoldIssue: HTML-comment placeholder and blank lines are stripped', () => {
  const body = '<!-- scrie aici -->\n\nheadline: bun\n\n';
  assert.deepEqual(parseGoldIssue(body), [{ field: 'headline', text: 'bun' }]);
});

test('parseGoldIssue: multi-line body yields one entry per line', () => {
  const out = parseGoldIssue('headline: a\npill: b\nc');
  assert.deepEqual(out, [
    { field: 'headline', text: 'a' },
    { field: 'pill', text: 'b' },
    { field: 'pill', text: 'c' },
  ]);
});

test('parseGoldIssue: empty/placeholder-only body returns []', () => {
  assert.deepEqual(parseGoldIssue('<!-- x -->\n  \n'), []);
});

test('appendGold: dedup makes re-adding the same line a no-op', () => {
  const existing = [{ field: 'pill', text: 'a' }];
  const out = appendGold(existing, [{ field: 'pill', text: 'a' }], 12);
  assert.deepEqual(out, [{ field: 'pill', text: 'a' }]);
});

test('appendGold: distinct fields with same text are NOT dedup-collapsed', () => {
  const out = appendGold([], [
    { field: 'pill', text: 'a' },
    { field: 'headline', text: 'a' },
  ], 12);
  assert.equal(out.length, 2);
});

test('appendGold: per-field FIFO cap drops the oldest of that field', () => {
  const existing = Array.from({ length: 12 }, (_, i) => ({ field: 'pill', text: `p${i}` }));
  const out = appendGold(existing, [{ field: 'pill', text: 'new' }], 12);
  assert.equal(out.filter((e) => e.field === 'pill').length, 12);
  assert.ok(!out.some((e) => e.text === 'p0'));
  assert.ok(out.some((e) => e.text === 'new'));
});

test('appendGold: the cap is per field, not global', () => {
  const existing = Array.from({ length: 12 }, (_, i) => ({ field: 'pill', text: `p${i}` }));
  const out = appendGold(existing, [{ field: 'headline', text: 'h' }], 12);
  assert.equal(out.filter((e) => e.field === 'pill').length, 12);
  assert.equal(out.filter((e) => e.field === 'headline').length, 1);
});

test('loadGold: missing file returns []', async () => {
  await withTempFile(null, async (file) => {
    assert.deepEqual(await loadGold(file), []);
  });
});

test('loadGold: malformed JSON throws (never silently empty)', async () => {
  await withTempFile('{ not json', async (file) => {
    await assert.rejects(() => loadGold(file));
  });
});

test('loadGold: an over-cap file is trimmed per field on read', async () => {
  const entries = Array.from({ length: 20 }, (_, i) => ({ field: 'pill', text: `p${i}` }));
  await withTempFile(JSON.stringify(entries), async (file) => {
    const out = await loadGold(file, 12);
    assert.equal(out.filter((e) => e.field === 'pill').length, 12);
    assert.ok(out.some((e) => e.text === 'p19'));
    assert.ok(!out.some((e) => e.text === 'p0'));
  });
});

test('loadGold: an entry with an unknown field throws (corrupt archive)', async () => {
  await withTempFile(JSON.stringify([{ field: 'bogus', text: 'x' }]), async (file) => {
    await assert.rejects(() => loadGold(file));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/gold.test.js`
Expected: FAIL — `Cannot find module '../pipeline/gold.js'`.

- [ ] **Step 3: Implement `pipeline/gold.js`**

```javascript
/**
 * The gold archive: a small, hand-blessed set of narration lines the owner
 * loved, fed back into the prompt as few-shot taste examples (the positive
 * mirror of the avoid-list). This module owns reading, parsing, and appending
 * those lines; it has no model or network dependency.
 *
 * A line is { field, text } where field is one of the four schema text fields.
 * A per-field FIFO cap bounds the prompt; it is applied on both append and load
 * so a hand-edited or seed-written file that overshoots is still bounded.
 */

import { readFile, writeFile } from 'node:fs/promises';

export const GOLD_FIELDS = new Set(['headline', 'summary', 'pill', 'tonight']);
export const DEFAULT_CAP = 12;

/** Keeps only the last `cap` entries of each field, preserving overall order. */
function capPerField(entries, cap) {
  const counts = {};
  const kept = [];
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const { field } = entries[i];
    counts[field] = (counts[field] ?? 0) + 1;
    if (counts[field] <= cap) kept.push(entries[i]);
  }
  return kept.reverse();
}

/**
 * Parses a gold-promotion issue body into [{field, text}]. One entry per
 * non-blank line. A line starting with exactly `headline:`/`summary:`/`pill:`/
 * `tonight:` (case-insensitive) takes that field; anything else — including a
 * line that merely contains a colon, like a clock time — is kept whole as a
 * `pill`. HTML-comment placeholders are stripped. A valid prefix with empty
 * text is skipped.
 */
export function parseGoldIssue(body) {
  const cleaned = (body ?? '').replace(/<!--[\s\S]*?-->/g, '');
  const entries = [];
  for (const raw of cleaned.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/^([a-zA-Z]+):\s*(.*)$/);
    const field = match && match[1].toLowerCase();
    if (match && GOLD_FIELDS.has(field)) {
      const text = match[2].trim();
      if (text) entries.push({ field, text });
    } else {
      entries.push({ field: 'pill', text: line });
    }
  }
  return entries;
}

/** Appends new entries, dropping exact {field,text} duplicates, then caps per field. */
export function appendGold(existing, entries, cap = DEFAULT_CAP) {
  const seen = new Set(existing.map((e) => `${e.field} ${e.text}`));
  const merged = [...existing];
  for (const e of entries) {
    const key = `${e.field} ${e.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(e);
  }
  return capPerField(merged, cap);
}

/** Validates one parsed entry; throws on a corrupt shape so a bad file is never trusted. */
function assertEntry(e) {
  if (!e || typeof e.text !== 'string' || !GOLD_FIELDS.has(e.field)) {
    throw new Error(`gold.json: invalid entry ${JSON.stringify(e)}`);
  }
}

/**
 * Reads the gold archive, capped per field. Missing file → []. Malformed JSON
 * or a corrupt entry THROWS — the caller decides whether to proceed gold-less
 * (narrator path) or abort (append path); we never silently return [] on a
 * corrupt file, which would let an append overwrite and erase the archive.
 */
export async function loadGold(filePath, cap = DEFAULT_CAP) {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch {
    return [];
  }
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('gold.json: expected a JSON array');
  parsed.forEach(assertEntry);
  return capPerField(parsed, cap);
}

/** Writes the archive as pretty JSON with a trailing newline. */
export async function writeGold(filePath, entries) {
  await writeFile(filePath, `${JSON.stringify(entries, null, 2)}\n`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/gold.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add pipeline/gold.js test/gold.test.js
git commit -m "feat: gold archive parse/load/append core"
```

---

## Task 2: `gold.js` — `add-from-issue` CLI

**Files:**
- Modify: `pipeline/gold.js`
- Test: `test/gold.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// append to test/gold.test.js
import { addFromIssue } from '../pipeline/gold.js';
import { readFile } from 'node:fs/promises';

test('addFromIssue: appends parsed body entries to the file', async () => {
  await withTempFile('[]', async (file) => {
    await addFromIssue(file, 'headline: nou\npill: altul');
    const out = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(out, [
      { field: 'headline', text: 'nou' },
      { field: 'pill', text: 'altul' },
    ]);
  });
});

test('addFromIssue: a corrupt existing file aborts without overwriting', async () => {
  await withTempFile('{ broken', async (file) => {
    await assert.rejects(() => addFromIssue(file, 'pill: x'));
    assert.equal(await readFile(file, 'utf8'), '{ broken');
  });
});

test('addFromIssue: empty body leaves the file unchanged', async () => {
  await withTempFile('[]', async (file) => {
    await addFromIssue(file, '<!-- x -->');
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), []);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/gold.test.js`
Expected: FAIL — `addFromIssue` is not exported.

- [ ] **Step 3: Implement the CLI in `pipeline/gold.js`**

Add to the imports at the top:

```javascript
import { fileURLToPath } from 'node:url';
import path from 'node:path';
```

Append before the end of the file:

```javascript
/**
 * Appends a promotion issue body to the gold file. Loads (throwing on a corrupt
 * file so it is never clobbered), parses, dedup-appends with the cap, writes.
 */
export async function addFromIssue(filePath, body, cap = DEFAULT_CAP) {
  const existing = await loadGold(filePath, cap);
  const merged = appendGold(existing, parseGoldIssue(body), cap);
  await writeGold(filePath, merged);
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun && process.argv[2] === 'add-from-issue') {
  const file = path.join(fileURLToPath(new URL('.', import.meta.url)), 'gold.json');
  const body = process.env.GOLD_ISSUE_BODY ?? '';
  addFromIssue(file, body).then(
    () => console.log('gold.json updated'),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}
```

Note: the CLI reads the body from `GOLD_ISSUE_BODY` (never an argv, never inline shell) — the same shell-injection guard `re-narrate.yml` already uses for `STEER`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/gold.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/gold.js test/gold.test.js
git commit -m "feat: gold add-from-issue CLI"
```

---

## Task 3: Inject the gold block into `buildUserMessage`

**Files:**
- Modify: `pipeline/narration-core.js:148-165` (the `buildUserMessage` function)
- Test: `test/gold.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// append to test/gold.test.js
import { buildUserMessage } from '../pipeline/narration-core.js';

const FACTS = { date: '2026-06-16', finished: [], tonight: [], standings: [] };

test('buildUserMessage: gold renders a grouped EXEMPLE block', () => {
  const gold = [
    { field: 'headline', text: 'titlu bun' },
    { field: 'pill', text: 'pastilă bună' },
    { field: 'tonight', text: 'motiv bun' },
  ];
  const msg = buildUserMessage(FACTS, [], null, gold);
  assert.match(msg, /EXEMPLE DE TON REUȘIT/);
  assert.match(msg, /sunt din alte meciuri/);
  assert.match(msg, /HEADLINE: titlu bun/);
  assert.match(msg, /PILL: pastilă bună/);
  assert.match(msg, /TONIGHT: motiv bun/);
});

test('buildUserMessage: no gold leaves the message free of the block', () => {
  const withoutArg = buildUserMessage(FACTS, [], null);
  const withEmpty = buildUserMessage(FACTS, [], null, []);
  assert.equal(withEmpty, withoutArg);
  assert.doesNotMatch(withoutArg, /EXEMPLE DE TON REUȘIT/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/gold.test.js`
Expected: FAIL — gold block absent, `HEADLINE: titlu bun` not found.

- [ ] **Step 3: Implement the injection**

In `pipeline/narration-core.js`, add this constant just above `buildUserMessage`:

```javascript
const GOLD_LABELS = { headline: 'HEADLINE', summary: 'SUMMARY', pill: 'PILL', tonight: 'TONIGHT' };
const GOLD_ORDER = ['headline', 'summary', 'pill', 'tonight'];
```

Change the signature and add the block (the existing body up to `return message;` stays; insert the gold block immediately before `return message;`):

```javascript
export function buildUserMessage(facts, recentProse, rawSteer, gold = []) {
  let message = `FAPTELE DE AZI (JSON):\n${JSON.stringify(facts, null, 2)}`;
  if (recentProse?.length) {
    const avoid = recentProse.map((line) => `- ${line}`).join('\n');
    message += `

TEXTE DIN ZILELE TRECUTE — NU le reutiliza. Evită aceleași glume, metafore și imagini
(de ex. „brutarii", „masochism matinal", aceeași construcție de titlu). Caută unghiuri noi:
${avoid}`;
  }
  const steer = normalizeSteer(rawSteer);
  if (steer) {
    message += `

NOTĂ DE LA EDITOR (se aplică doar la această regenerare): ${steer}`;
  }
  if (gold?.length) {
    const lines = [];
    for (const field of GOLD_ORDER) {
      for (const entry of gold.filter((e) => e.field === field)) {
        lines.push(`${GOLD_LABELS[field]}: ${entry.text}`);
      }
    }
    message += `

EXEMPLE DE TON REUȘIT — așa sună o frază bună din ALTE zile (ritm, înțepătură, concret).
NU copia conținutul și nu împrumuta numele/cifrele din ele — sunt din alte meciuri.
Potrivește ACEST nivel de umor și de precizie la faptele de AZI:
${lines.join('\n')}`;
  }
  return message;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/gold.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full suite to confirm no positional-arg regression**

Run: `npm test`
Expected: PASS — existing `buildUserMessage` callers (3-arg) are unaffected by the new optional 4th arg.

- [ ] **Step 6: Commit**

```bash
git add pipeline/narration-core.js test/gold.test.js
git commit -m "feat: inject gold few-shot block into the narration prompt"
```

---

## Task 4: Gold-target reminder in the rewrite system prompt

**Files:**
- Modify: `pipeline/narration-core.js:211-219` (`buildRewriteSystemPrompt`)
- Test: `test/gold.test.js`

Why: under `gemini-polish` (production default) the shipped prose comes from the rewrite call, whose system prompt currently says "preserve the draft's tone, change only flagged idioms." The rewrite reuses the original user message (so the gold block is present), but without a reminder the rewrite can treat the gold examples as noise. One sentence makes the system prompt agree with the gold block.

- [ ] **Step 1: Write the failing test**

```javascript
// append to test/gold.test.js
import { buildRewriteSystemPrompt } from '../pipeline/narration-core.js';

test('buildRewriteSystemPrompt: keeps the gold examples as the tone target', () => {
  const prompt = buildRewriteSystemPrompt('— „a deschis" → „a deschis scorul"');
  assert.match(prompt, /EXEMPLE DE TON REUȘIT/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/gold.test.js`
Expected: FAIL — the rewrite prompt does not mention the gold examples.

- [ ] **Step 3: Implement**

In `pipeline/narration-core.js`, edit `buildRewriteSystemPrompt` to add one paragraph after the critique injection:

```javascript
export function buildRewriteSystemPrompt(critique) {
  return `${SYSTEM_PROMPT}

UN REDACTOR ROMÂN ți-a revizuit textul anterior și a notat unde limba sună a traducere sau
nenatural. Rescrie digestul aplicând EXACT aceste observații de limbă. Păstrează intacte
faptele, tonul, umorul și headline-ul punchy — schimbi DOAR formulările semnalate (și altele
similare pe care le observi tu).

Dacă mesajul cu faptele conține EXEMPLE DE TON REUȘIT, acelea rămân ținta de ton: păstrează
acel nivel de umor, ritm și concret — nu coborî sub el când corectezi limba. Observațiile
redactorului:
${critique}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/gold.test.js && node --test test/narration-polish.test.js`
Expected: PASS (the polish test still passes — it does not assert the exact prompt text).

- [ ] **Step 5: Commit**

```bash
git add pipeline/narration-core.js test/gold.test.js
git commit -m "feat: keep gold examples as the tone target in the rewrite pass"
```

---

## Task 5: Thread gold through `narrate()` (single-pass Gemini)

**Files:**
- Modify: `pipeline/narrate.js:197-200`
- Test: `test/narrate.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// append to test/narrate.test.js
test('narrate threads gold into the user message', async () => {
  const realFetch = globalThis.fetch;
  let sentBody = null;
  globalThis.fetch = async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(VALID_NARRATION) }] } }] }),
    };
  };
  try {
    await narrate(facts, { apiKey: 'x', gold: [{ field: 'pill', text: 'aur' }], sleep: async () => {} });
  } finally {
    globalThis.fetch = realFetch;
  }
  const userText = sentBody.contents[0].parts[0].text;
  assert.match(userText, /EXEMPLE DE TON REUȘIT/);
  assert.match(userText, /PILL: aur/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/narrate.test.js`
Expected: FAIL — `narrate` ignores `gold`, the block is absent.

- [ ] **Step 3: Implement**

In `pipeline/narrate.js`, change `narrate`:

```javascript
export async function narrate(facts, { apiKey, model = DEFAULT_MODEL, recentProse = [], steer = null, gold = [], sleep = realSleep } = {}) {
  const userMessage = buildUserMessage(facts, recentProse, steer, gold);
  return callGeminiResilient({ apiKey, model, systemPrompt: SYSTEM_PROMPT, userMessage, schema: responseSchema, sleep });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/narrate.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/narrate.js test/narrate.test.js
git commit -m "feat: thread gold through single-pass narrate"
```

---

## Task 6: Thread gold through `getNarration` and `geminiNarration` (all paths)

**Files:**
- Modify: `pipeline/run.js:186-197` (`geminiNarration`), `pipeline/run.js:216-261` (`getNarration`)
- Test: `test/narrator-select.test.js`

- [ ] **Step 1: Read the existing selector test to match its stubbing style**

Run: `sed -n '1,60p' test/narrator-select.test.js`
Expected: shows how `getNarration` is called with injected engines (`geminiDraftEngine`, etc.) and how `process.env.NARRATOR` is set/reset.

- [ ] **Step 2: Write the failing test**

```javascript
// append to test/narrator-select.test.js — adjust imports to match the file's existing ones
test('getNarration passes gold into the gemini-polish draft user message', async () => {
  const prev = process.env.NARRATOR;
  process.env.NARRATOR = 'gemini-polish';
  let seenMessage = null;
  const polishEngine = async ({ userMessage }) => {
    seenMessage = userMessage;
    return { narration: { headline: 'h', summary: 's', matches: [], tonight: [] }, polished: true };
  };
  try {
    await getNarration(
      { date: '2026-06-16', finished: [], tonight: [], standings: [] },
      { recentProse: [], steer: null, gold: [{ field: 'headline', text: 'aur' }], polishEngine },
    );
  } finally {
    if (prev === undefined) delete process.env.NARRATOR; else process.env.NARRATOR = prev;
  }
  assert.match(seenMessage, /HEADLINE: aur/);
});

test('getNarration passes gold into the single-pass gemini path', async () => {
  const prev = process.env.NARRATOR;
  delete process.env.NARRATOR; // unset → plain gemini single-pass
  process.env.GEMINI_API_KEY = 'x';
  const realFetch = globalThis.fetch;
  let sentBody = null;
  globalThis.fetch = async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"headline":"h","summary":"s","matches":[],"tonight":[]}' }] } }] }) };
  };
  try {
    await getNarration(
      { date: '2026-06-16', finished: [], tonight: [], standings: [] },
      { recentProse: [], steer: null, gold: [{ field: 'pill', text: 'aur2' }] },
    );
  } finally {
    globalThis.fetch = realFetch;
    if (prev === undefined) delete process.env.NARRATOR; else process.env.NARRATOR = prev;
  }
  assert.match(sentBody.contents[0].parts[0].text, /PILL: aur2/);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test test/narrator-select.test.js`
Expected: FAIL — gold not threaded; `HEADLINE: aur` / `PILL: aur2` absent.

- [ ] **Step 4: Implement**

In `pipeline/run.js`, change `geminiNarration` to accept and forward gold:

```javascript
function geminiNarration(facts, { fixtures, recentProse, steer, gold }) {
  if (fixtures) {
    const cannedPath = path.join(fixtures, 'narration.json');
    if (existsSync(cannedPath)) return readJson(cannedPath);
  }
  return narrate(facts, {
    apiKey: requireEnv('GEMINI_API_KEY'),
    model: process.env.GEMINI_MODEL || undefined,
    recentProse,
    steer,
    gold,
  });
}
```

Change `getNarration`'s options and every `buildUserMessage` / `geminiNarration` call inside it:

```javascript
export async function getNarration(facts, {
  fixtures, recentProse, steer, gold = [],
  claudeEngine = callClaude,
  polishEngine = polishedNarration,
  geminiDraftEngine = callGeminiNarration,
  geminiCritiqueEngine = callGeminiText,
} = {}) {
  const mode = process.env.NARRATOR;

  if (mode === 'gemini-polish' && !fixtures) {
    const model = process.env.GEMINI_MODEL || undefined;
    const userMessage = buildUserMessage(facts, recentProse, steer, gold);
    const { narration, polished } = await polishEngine({
      model, userMessage, draftEngine: geminiDraftEngine, critiqueEngine: geminiCritiqueEngine,
    });
    return { narration, narrator: polished ? 'gemini-polish' : 'gemini' };
  }

  if (mode !== 'opus' && mode !== 'opus-polish') {
    return { narration: await geminiNarration(facts, { fixtures, recentProse, steer, gold }), narrator: 'gemini' };
  }
  const model = process.env.CLAUDE_MODEL || 'opus';
  const userMessage = buildUserMessage(facts, recentProse, steer, gold);
  try {
    if (mode === 'opus-polish') {
      const { narration, polished } = await polishEngine({ model, userMessage, draftEngine: claudeEngine });
      return { narration, narrator: polished ? 'opus-polish' : 'opus' };
    }
    return { narration: await claudeEngine({ model, userMessage, systemPrompt: SYSTEM_PROMPT }), narrator: 'opus' };
  } catch (error) {
    const cause = error.auth ? 'auth failure' : 'bad output after retries';
    console.warn(`Opus narration failed (${cause}): ${error.message}. Falling back to Gemini.`);
    return { narration: await geminiNarration(facts, { fixtures, recentProse, steer, gold }), narrator: 'gemini-fallback' };
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/narrator-select.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add pipeline/run.js test/narrator-select.test.js
git commit -m "feat: thread gold through every getNarration path"
```

---

## Task 7: Load gold in `main()` and subtract it from the avoid-list

**Files:**
- Modify: `pipeline/run.js` (imports, a `loadGoldSafe` helper, the `else` branch in `main`)
- Test: `test/run.test.js`

- [ ] **Step 1: Inspect `test/run.test.js` to learn how `main`/exports are tested**

Run: `sed -n '1,50p' test/run.test.js`
Expected: shows which symbols `run.js` exports and how the test imports them. The exported pure functions (`mergeEnrichment`, `injectOgTags`) are unit-tested directly; `main` is not driven end-to-end in unit tests. We will export the gold/avoid-list reconciliation as a pure function and test that.

- [ ] **Step 2: Write the failing test**

```javascript
// append to test/run.test.js — match the file's existing import line for run.js
import { withoutGold } from '../pipeline/run.js';

test('withoutGold removes promoted lines from the avoid-list', () => {
  const recent = ['o frază veche', 'linia de aur', 'altă frază'];
  const gold = [{ field: 'pill', text: 'linia de aur' }];
  assert.deepEqual(withoutGold(recent, gold), ['o frază veche', 'altă frază']);
});

test('withoutGold is a no-op when gold is empty', () => {
  const recent = ['a', 'b'];
  assert.deepEqual(withoutGold(recent, []), ['a', 'b']);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/run.test.js`
Expected: FAIL — `withoutGold` is not exported.

- [ ] **Step 4: Implement**

In `pipeline/run.js`, add the import near the other pipeline imports:

```javascript
import { loadGold } from './gold.js';
```

Add a constant near `DATA_DIR`:

```javascript
const GOLD_PATH = path.join(ROOT, 'pipeline', 'gold.json');
```

Add the pure helper and a safe loader near `recentProseBefore`:

```javascript
/** Drops avoid-list lines that are now blessed gold, so a promoted line is taught, not forbidden. */
export function withoutGold(recentProse, gold) {
  if (!gold.length) return recentProse;
  const goldTexts = new Set(gold.map((g) => g.text));
  return recentProse.filter((line) => !goldTexts.has(line));
}

/** Loads the gold archive, degrading to no-gold (never failing the run) on a corrupt file. */
async function loadGoldSafe() {
  try {
    return await loadGold(GOLD_PATH);
  } catch (error) {
    console.warn(`gold.json unreadable (${error.message}); proceeding without gold.`);
    return [];
  }
}
```

Change the `else` branch in `main` (currently `run.js:374-381`) to load gold, subtract it, and pass it:

```javascript
  } else {
    const gold = await loadGoldSafe();
    const recentProse = args.fixtures
      ? []
      : withoutGold(await recentProseBefore(dataDir, date), gold);
    ({ narration, narrator } = await getNarration(factsForNarration, {
      fixtures: args.fixtures,
      recentProse,
      steer: args.steer,
      gold,
    }));
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/run.test.js`
Expected: PASS.

- [ ] **Step 6: Offline end-to-end smoke (gold reaches a real build)**

Create a throwaway fixtures gold + run without `narration.json` so the user message is actually built. Use the existing fixtures matches/standings but force a live-ish path by pointing at a temp fixtures dir that omits `narration.json`:

```bash
# Seed a tiny gold file (will be overwritten by the real seed session in Task 9)
printf '[{"field":"pill","text":"SMOKE-GOLD-LINE"}]\n' > pipeline/gold.json
# Confirm loadGold + withoutGold wire up without throwing (unit-level already proven);
# here just assert the file loads through the CLI path:
GOLD_ISSUE_BODY='pill: another' node pipeline/gold.js add-from-issue
cat pipeline/gold.json   # shows both entries
git checkout pipeline/gold.json 2>/dev/null || rm -f pipeline/gold.json
```

Expected: `gold.json updated`, file shows both entries, then it is reverted/removed (the real archive is written in Task 9).

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add pipeline/run.js test/run.test.js
git commit -m "feat: load gold and subtract it from the avoid-list in run.js"
```

---

## Task 8: Regression fix — tonight lines must name the teams

**Files:**
- Modify: `pipeline/narration-core.js` (the rank-as-tool note inside `SYSTEM_PROMPT`, around the rule-5 / „homeRank" block, `narration-core.js:69-89`)

Why: 2026-06-16's tonight lines went anonymous ("E la o oră decentă, un meci între două forțe…") because the "hide the FIFA rank number" rule overcorrected and the model dropped team names too. This is prompt text, judged by re-narration, not a unit test.

- [ ] **Step 1: Edit the rank-as-tool note**

In `pipeline/narration-core.js`, find the sentence beginning `Rangul e UNEALTĂ DE JUDECATĂ, nu text de afișat:` and replace that sentence with:

```
       Rangul e UNEALTĂ DE JUDECATĂ, nu text de afișat: NU scrie „pe locul N mondial" sau
       „(locul N)" în „why". ASCUNZI CIFRA, NU ECHIPELE — fiecare „why" numește mereu cine
       joacă (ambele echipe pe nume); traduci diferența de valoare în cuvinte („mare favorită",
       „cu mult peste", „două forțe egale"), niciodată într-un număr. O propoziție fără numele
       echipelor („un meci între două forțe") e un eșec — rescrie-o cu cine intră pe teren.
```

- [ ] **Step 2: Run the full suite (no prompt-text assertion should break)**

Run: `npm test`
Expected: PASS — no test pins the exact prompt wording.

- [ ] **Step 3: Commit**

```bash
git add pipeline/narration-core.js
git commit -m "fix: tonight lines must name the teams, hide only the rank number"
```

- [ ] **Step 4: Verify by re-narration (scenario — after Task 9 seeds gold, or standalone now)**

Run (offline is not enough — this needs the live model; do it as part of the final verification, or now against a committed day):

```bash
node pipeline/run.js --re-narrate --date 2026-06-16 --out tmp/regression-check
node -e "const d=require('./tmp/regression-check/2026-06-16.json'); d.tonight.forEach(t=>console.log(t.alarm,'::',t.why))"
```

Expected: every printed `why` names both teams and contains no "locul N". (Needs `GEMINI_API_KEY` in `.env`.)

---

## Task 9: Seed session (interactive, owner-driven) — gated manual step

**Files:**
- Create: `pipeline/gold.json`

This step is NOT automated. The implementing agent runs it interactively WITH the owner.

- [ ] **Step 1: Dump every candidate line from the committed digests**

```bash
for f in site/data/2026-06-*.json; do
  node -e "const d=require('./$f'); const date='$f'.split('/').pop().replace('.json',''); console.log('=== '+date+' ==='); console.log('headline:: '+d.headline); console.log('summary:: '+d.summary); (d.matches||[]).forEach(m=>console.log('pill:: '+m.pill)); (d.tonight||[]).forEach(t=>console.log('tonight:: '+t.why));"
done
```

- [ ] **Step 2: Walk the owner through keep / rewrite / skip, one digest at a time**

For each printed line, the agent asks the owner: **keep** (line enters gold verbatim), **rewrite** (owner dictates his wording; the rewrite enters gold), or **skip**. Prefer rewrites over verbatim keeps — they carry the owner's voice and are least likely to leak a proper noun. Accumulate `{field, text}` entries (field = the `field::` prefix of that line).

- [ ] **Step 3: Write the seed file through the capped append**

Build the accumulated entries into a JSON array and write via the CLI so the per-field cap applies (do this once with the full accumulated body):

```bash
GOLD_ISSUE_BODY="$(cat <<'EOF'
headline: <kept-or-rewritten line>
pill: <kept-or-rewritten line>
tonight: <kept-or-rewritten line>
EOF
)" node pipeline/gold.js add-from-issue
cat pipeline/gold.json
```

(The file starts absent → `loadGold` returns `[]` → the append seeds it.)

- [ ] **Step 4: Commit the seed**

```bash
git add pipeline/gold.json
git commit -m "feat: seed gold archive from owner-curated digest lines"
```

---

## Task 10: GitHub workflow — gold promotion job

**Files:**
- Modify: `.github/workflows/re-narrate.yml`

- [ ] **Step 1: Add `concurrency` and the `gold` job**

Replace the contents of `.github/workflows/re-narrate.yml` with:

```yaml
name: Re-narrate digest

# Two thin triggers, both gated on the repo owner opening a labeled issue:
#   label "re-narrate" -> dispatch digest.yml force=true with the issue body as a
#     one-shot steering note (fix today's prose).
#   label "gold"       -> append the issue body's lines to pipeline/gold.json, push,
#     then dispatch digest.yml force=true so today is re-narrated WITH the new gold
#     (which is now on main) and the existing deploy + email run. The fresh digest
#     email is the confirmation.
# Joined to the digest concurrency group so a gold push never collides with the
# nightly digest's push.

on:
  issues:
    types: [opened]

permissions:
  issues: write
  actions: write
  contents: write

concurrency:
  group: digest
  cancel-in-progress: false

jobs:
  re-narrate:
    if: >
      contains(github.event.issue.labels.*.name, 're-narrate') &&
      github.event.issue.user.login == 'mcandea04'
    runs-on: ubuntu-latest
    steps:
      - name: Dispatch digest workflow
        env:
          GH_TOKEN: ${{ github.token }}
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

  gold:
    if: >
      contains(github.event.issue.labels.*.name, 'gold') &&
      github.event.issue.user.login == 'mcandea04'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
      - name: Append the promoted line(s) to gold.json
        env:
          # Issue body travels via env, never inline in the script (shell injection).
          GOLD_ISSUE_BODY: ${{ github.event.issue.body }}
        run: node pipeline/gold.js add-from-issue
      - name: Commit and push gold.json
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add pipeline/gold.json
          if git diff --cached --quiet; then
            echo "No new gold (duplicate or empty); skipping commit."
          else
            git commit -m "gold: promote line(s) from issue #${{ github.event.issue.number }}"
            git pull --rebase origin main
            git push
          fi
      - name: Re-narrate today with the new gold, then deploy + email
        env:
          GH_TOKEN: ${{ github.token }}
        # gold.json is now on main, so the dispatched digest run checks it out and
        # the fresh prose sees the new gold. force=true => re-narrate + email.
        run: |
          gh workflow run digest.yml --repo "$GITHUB_REPOSITORY" -f force=true
      - name: Confirm and close issue
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh issue comment "${{ github.event.issue.number }}" --repo "$GITHUB_REPOSITORY" \
            --body "Fraza a fost salvată în gold și am pornit regenerarea de azi cu ea. Vei primi un email. Progres: https://github.com/$GITHUB_REPOSITORY/actions/workflows/digest.yml"
          gh issue close "${{ github.event.issue.number }}" --repo "$GITHUB_REPOSITORY"
```

- [ ] **Step 2: Lint the YAML locally**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('.github/workflows/re-narrate.yml','utf8');if(!s.includes('job') || !s.includes('gold:'))process.exit(1);console.log('yaml shape ok')"`
Expected: `yaml shape ok` (a shape check; full validation happens on push).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/re-narrate.yml
git commit -m "feat: gold promotion job appends, pushes, re-narrates"
```

---

## Task 11: Email — gold link + email on a no-change forced run

**Files:**
- Modify: `.github/workflows/digest.yml` (the `Email digest ready` step and its body, `digest.yml:145-167`)

- [ ] **Step 1: Add the gold link and widen the email condition**

In `.github/workflows/digest.yml`, change the email step. Replace its `if:` and `body:`:

```yaml
      - name: Email digest ready
        # Email when a commit landed, OR when this was a forced (re-narrate/gold)
        # run that produced no change — so the owner always gets confirmation.
        if: >
          steps.build.outputs.published == 'true' &&
          (steps.commit.outputs.committed == 'true' ||
           (github.event_name == 'workflow_dispatch' && inputs.force == 'true'))
        uses: dawidd6/action-send-mail@v3
        with:
          server_address: smtp.gmail.com
          server_port: 465
          secure: true
          username: ${{ secrets.MAIL_USERNAME }}
          password: ${{ secrets.MAIL_PASSWORD }}
          from: Mondial <${{ secrets.MAIL_USERNAME }}>
          to: ${{ secrets.MAIL_TO }}
          subject: "⚽ Mondialul de dimineață — ${{ steps.build.outputs.date }}"
          body: |
            ${{ steps.build.outputs.headline }}

            ${{ steps.build.outputs.match_count }} meciuri azi-noapte.${{ steps.commit.outputs.committed == 'true' && ' ' || ' (regenerat, proza neschimbată) ' }}

            Citește digestul: https://mcandea04.github.io/mondial/

            Nu-ți place proza? Regenerează: https://github.com/mcandea04/mondial/issues/new?title=re-narrate&labels=re-narrate&body=%3C%21--%20scrie%20aici%2C%20op%C8%9Bional%2C%20ce%20vrei%20schimbat%20la%20ton%20sau%20glume%20--%3E

            Ți-a plăcut o frază? Salveaz-o pentru data viitoare: https://github.com/mcandea04/mondial/issues/new?title=gold&labels=gold&body=%3C%21--%20Lipe%C8%99te%20o%20linie%20pe%20r%C3%A2nd.%20Op%C8%9Bional%20pune%20%C3%AEn%20fa%C8%9B%C4%83%20headline%3A%20summary%3A%20pill%3A%20tonight%3A%20-%20altfel%20e%20pill.%20Po%C8%9Bi%20s%C4%83%20o%20rescrii%20%C3%AEn%20cuvintele%20tale.%20--%3E

            ---
            Proză: ${{ steps.build.outputs.narrator }} (dacă scrie „gemini-fallback", tokenul Opus a expirat — rulează din nou claude setup-token și actualizează secretul CLAUDE_CODE_OAUTH_TOKEN)
```

- [ ] **Step 2: Shape-check the workflow**

Run: `node -e "const s=require('fs').readFileSync('.github/workflows/digest.yml','utf8');if(!s.includes('title=gold'))process.exit(1);console.log('gold link present')"`
Expected: `gold link present`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/digest.yml
git commit -m "feat: gold promotion email link + confirm forced re-narrate runs"
```

---

## Task 12: Create the `gold` GitHub label (setup)

**Files:** none (repo metadata).

- [ ] **Step 1: Create the label**

```bash
gh label create gold --repo mcandea04/mondial --color FFD700 --description "Promote a digest line into the gold archive" || echo "label may already exist"
```

Expected: the label is created (or the "already exists" message). Without it, the email link's `labels=gold` cannot apply and the gold job never fires.

---

## Task 13: Full verification

- [ ] **Step 1: Whole suite green**

Run: `npm test`
Expected: PASS, clean output (no stray warnings/logs).

- [ ] **Step 2: code-simplifier on changed files**

Dispatch the `code-simplifier` subagent over `pipeline/gold.js`, the `narration-core.js`/`run.js`/`narrate.js` diffs, and the new tests. Apply only behavior-preserving simplifications.

- [ ] **Step 3: Re-run the suite after simplification**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Live scenario — re-narrate 2026-06-16 with gold seeded**

```bash
NARRATOR=gemini-polish node pipeline/run.js --re-narrate --date 2026-06-16 --out tmp/gold-check
node -e "const d=require('./tmp/gold-check/2026-06-16.json'); console.log('HEADLINE:',d.headline); console.log('SUMMARY:',d.summary); d.matches.forEach(m=>console.log('PILL:',m.pill)); d.tonight.forEach(t=>console.log('TONIGHT['+t.alarm+']:',t.why))"
```

Expected (judge by eye): tonight lines name both teams (regression fixed); pills carry more bite and echo the gold rhythm without copying gold content; no leaked team name that did not play 2026-06-16.

- [ ] **Step 5: Polish-keep A/B (decision, not removal)**

```bash
NARRATOR=gemini-polish node pipeline/run.js --re-narrate --date 2026-06-16 --out tmp/ab-polish
NARRATOR=gemini        node pipeline/run.js --re-narrate --date 2026-06-16 --out tmp/ab-plain
# Compare the two by eye:
for v in polish plain; do echo "=== $v ==="; node -e "const d=require('./tmp/ab-$v/2026-06-16.json'); console.log(d.headline); d.matches.forEach(m=>console.log('-',m.pill))"; done
```

Expected: a side-by-side read. Keep the polish pass (default) unless gold-only is demonstrably as idiomatic; only then consider dropping it, with this evidence in hand. No code change in this step — it informs a later decision.

- [ ] **Step 6: Report to the owner**

Summarize: tests green, regression fixed (show the tonight lines), gold-influenced prose sample, and the A/B read with a keep/drop recommendation for the polish pass.

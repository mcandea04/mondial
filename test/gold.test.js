import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadGold, parseGoldIssue, appendGold, writeGold, addFromIssue } from '../pipeline/gold.js';
import { buildUserMessage, buildRewriteSystemPrompt } from '../pipeline/narration-core.js';

const FACTS = { date: '2026-06-16', finished: [], tonight: [], standings: [] };

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

test('writeGold + loadGold: roundtrip preserves entries', async () => {
  const entries = [{ field: 'pill', text: 'x' }, { field: 'headline', text: 'y' }];
  await withTempFile(null, async (file) => {
    await writeGold(file, entries);
    assert.deepEqual(await loadGold(file), entries);
  });
});

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

test('buildRewriteSystemPrompt: keeps the gold examples as the tone target', () => {
  const prompt = buildRewriteSystemPrompt('— „a deschis" → „a deschis scorul"');
  assert.match(prompt, /EXEMPLE DE TON REUȘIT/);
});

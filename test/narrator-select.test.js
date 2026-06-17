import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getNarration } from '../pipeline/run.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** A fixtures dir whose narration.json is the offline Gemini stand-in. */
function fixturesDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'mondial-narr-'));
  cpSync(path.join(ROOT, 'test', 'fixtures'), dir, { recursive: true });
  return dir;
}

const facts = { date: '2026-06-12', finished: [], tonight: [], standings: [] };
const cannedHeadline = JSON.parse(
  readFileSync(path.join(ROOT, 'test', 'fixtures', 'narration.json'), 'utf8'),
).headline;

const OPUS_OUT = {
  headline: 'Titlu scris de Opus',
  summary: 'Două propoziții. Chiar două.',
  matches: [],
  tonight: [],
};

test('NARRATOR unset uses Gemini and marks narrator "gemini"', async (t) => {
  t.after(() => { delete process.env.NARRATOR; });
  delete process.env.NARRATOR;
  const { narration, narrator } = await getNarration(facts, { fixtures: fixturesDir(), recentProse: [] });
  assert.equal(narrator, 'gemini');
  assert.equal(narration.headline, cannedHeadline);
});

test('NARRATOR=opus uses the Claude engine and marks narrator "opus"', async (t) => {
  t.after(() => { delete process.env.NARRATOR; });
  process.env.NARRATOR = 'opus';
  const claudeEngine = async () => OPUS_OUT;
  const { narration, narrator } = await getNarration(facts, {
    fixtures: fixturesDir(),
    recentProse: [],
    claudeEngine,
  });
  assert.equal(narrator, 'opus');
  assert.equal(narration.headline, 'Titlu scris de Opus');
});

test('NARRATOR=opus passes model, system prompt, and a steer-aware user message', async (t) => {
  t.after(() => { delete process.env.NARRATOR; delete process.env.CLAUDE_MODEL; });
  process.env.NARRATOR = 'opus';
  process.env.CLAUDE_MODEL = 'opus-test-alias';
  let received;
  const claudeEngine = async (args) => { received = args; return OPUS_OUT; };
  await getNarration(facts, { fixtures: fixturesDir(), recentProse: [], steer: 'mai scurt', claudeEngine });
  assert.equal(received.model, 'opus-test-alias');
  assert.match(received.systemPrompt, /digestul de dimineață/);
  assert.match(received.userMessage, /FAPTELE DE AZI/);
  assert.match(received.userMessage, /NOTĂ DE LA EDITOR.*mai scurt/s);
});

test('an Opus auth failure falls back to Gemini, marked "gemini-fallback"', async (t) => {
  t.after(() => { delete process.env.NARRATOR; });
  process.env.NARRATOR = 'opus';
  const claudeEngine = async () => {
    const err = new Error('claude auth failure: token expired');
    err.auth = true;
    throw err;
  };
  const { narration, narrator } = await getNarration(facts, {
    fixtures: fixturesDir(),
    recentProse: [],
    claudeEngine,
  });
  assert.equal(narrator, 'gemini-fallback');
  assert.equal(narration.headline, cannedHeadline, 'fell back to the canned Gemini narration');
});

test('an Opus bad-output failure also falls back to Gemini', async (t) => {
  t.after(() => { delete process.env.NARRATOR; });
  process.env.NARRATOR = 'opus';
  const claudeEngine = async () => { throw new Error('claude failed to produce valid narration'); };
  const { narrator } = await getNarration(facts, { fixtures: fixturesDir(), recentProse: [], claudeEngine });
  assert.equal(narrator, 'gemini-fallback');
});

test('NARRATOR=opus-polish marks narrator "opus-polish" when the polish succeeds', async (t) => {
  t.after(() => { delete process.env.NARRATOR; });
  process.env.NARRATOR = 'opus-polish';
  const polishEngine = async () => ({ narration: OPUS_OUT, polished: true });
  const { narration, narrator } = await getNarration(facts, { fixtures: fixturesDir(), recentProse: [], polishEngine });
  assert.equal(narrator, 'opus-polish');
  assert.equal(narration.headline, 'Titlu scris de Opus');
});

test('NARRATOR=opus-polish degrades to "opus" when only the polish stage fails', async (t) => {
  t.after(() => { delete process.env.NARRATOR; });
  process.env.NARRATOR = 'opus-polish';
  const polishEngine = async () => ({ narration: OPUS_OUT, polished: false });
  const { narrator } = await getNarration(facts, { fixtures: fixturesDir(), recentProse: [], polishEngine });
  assert.equal(narrator, 'opus', 'a failed polish ships the draft, not a Gemini fallback');
});

test('NARRATOR=opus-polish falls back to Gemini when the draft itself fails', async (t) => {
  t.after(() => { delete process.env.NARRATOR; });
  process.env.NARRATOR = 'opus-polish';
  const polishEngine = async () => { const e = new Error('auth failure'); e.auth = true; throw e; };
  const { narrator } = await getNarration(facts, { fixtures: fixturesDir(), recentProse: [], polishEngine });
  assert.equal(narrator, 'gemini-fallback');
});

test('NARRATOR=gemini-polish runs the Gemini polish pipeline and marks "gemini-polish"', async (t) => {
  t.after(() => { delete process.env.NARRATOR; });
  process.env.NARRATOR = 'gemini-polish';
  let received;
  // No fixtures: gemini-polish only runs live. The polishEngine is injected so
  // no network is touched; assert it receives the Gemini engines, not Claude.
  const polishEngine = async (args) => { received = args; return { narration: OPUS_OUT, polished: true }; };
  const { narration, narrator } = await getNarration(facts, { recentProse: [], polishEngine });
  assert.equal(narrator, 'gemini-polish');
  assert.equal(narration.headline, 'Titlu scris de Opus');
  assert.equal(typeof received.draftEngine, 'function', 'a Gemini draft engine was passed');
  assert.equal(typeof received.critiqueEngine, 'function', 'a Gemini critique engine was passed');
});

test('NARRATOR=gemini-polish degrades to "gemini" when only the polish stage fails', async (t) => {
  t.after(() => { delete process.env.NARRATOR; });
  process.env.NARRATOR = 'gemini-polish';
  const polishEngine = async () => ({ narration: OPUS_OUT, polished: false });
  const { narrator } = await getNarration(facts, { recentProse: [], polishEngine });
  assert.equal(narrator, 'gemini', 'a failed polish ships the draft, marked plain gemini');
});

test('NARRATOR=gemini-polish offline (fixtures) falls through to canned Gemini', async (t) => {
  t.after(() => { delete process.env.NARRATOR; });
  process.env.NARRATOR = 'gemini-polish';
  // With fixtures present there is no live polish; it returns the canned narration.
  const { narration, narrator } = await getNarration(facts, { fixtures: fixturesDir(), recentProse: [] });
  assert.equal(narrator, 'gemini');
  assert.equal(narration.headline, cannedHeadline);
});

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
  const prevKey = process.env.GEMINI_API_KEY;
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
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = prevKey;
  }
  assert.match(sentBody.contents[0].parts[0].text, /PILL: aur2/);
});

test('getNarration produces an EN narration alongside RO (opus)', async (t) => {
  t.after(() => { delete process.env.NARRATOR; });
  process.env.NARRATOR = 'opus';
  const EN_OUT = { headline: 'EN title', summary: 'Two sentences. Really two.', matches: [], tonight: [] };
  // claudeEngine is called twice: once for RO (SYSTEM_PROMPT), once for EN (SYSTEM_PROMPT_EN).
  const claudeEngine = async ({ systemPrompt }) =>
    /English/i.test(systemPrompt) ? EN_OUT : OPUS_OUT;
  const result = await getNarration(facts, { fixtures: fixturesDir(), recentProse: [], claudeEngine });
  assert.equal(result.narrator, 'opus');
  assert.equal(result.narration.headline, 'Titlu scris de Opus');
  assert.equal(result.en.narrator, 'opus');
  assert.equal(result.en.narration.headline, 'EN title');
});

test('getNarration: EN failure leaves en null, RO still ships', async (t) => {
  t.after(() => { delete process.env.NARRATOR; });
  process.env.NARRATOR = 'opus';
  const claudeEngine = async ({ systemPrompt }) => {
    if (/English/i.test(systemPrompt)) throw new Error('EN engine down');
    return OPUS_OUT;
  };
  const result = await getNarration(facts, { fixtures: fixturesDir(), recentProse: [], claudeEngine });
  assert.equal(result.narration.headline, 'Titlu scris de Opus');
  assert.equal(result.en, null);
});

test('getNarration (gemini single-pass) also produces EN', async (t) => {
  t.after(() => { delete process.env.NARRATOR; });
  delete process.env.NARRATOR;
  // Offline fixtures: RO from narration.json, EN from narration.en.json (Task 9).
  const result = await getNarration(facts, { fixtures: fixturesDir(), recentProse: [] });
  assert.equal(result.narrator, 'gemini');
  assert.ok(result.en, 'EN narration present offline');
  assert.equal(result.en.narrator, 'gemini');
});

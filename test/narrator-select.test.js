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

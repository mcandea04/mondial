import { test } from 'node:test';
import assert from 'node:assert/strict';
import { polishedNarration } from '../pipeline/narration-polish.js';
import { buildRewriteSystemPrompt, narrationToReviewText, SYSTEM_PROMPT_EN, CRITIQUE_SYSTEM_PROMPT_EN } from '../pipeline/narration-core.js';

const DRAFT = {
  headline: 'Draft cu un cap de McGinn',
  summary: 'Saibari a deschis pentru Maroc. A doua propoziție.',
  matches: [{ id: 9001, pill: 'Poarta intactă pentru Scoția.', drama: 2 }],
  tonight: [{ id: 9101, alarm: 'citești dimineața', why: 'Meci la 5.' }],
};
const REWRITE = {
  headline: 'O lovitură de cap a lui McGinn',
  summary: 'Saibari a deschis scorul pentru Maroc. A doua propoziție.',
  matches: [{ id: 9001, pill: 'Poarta neatinsă pentru Scoția.', drama: 2 }],
  tonight: [{ id: 9101, alarm: 'citești dimineața', why: 'Meci la 5.' }],
};

test('happy path: draft -> critique -> rewrite, polished true', async () => {
  const calls = [];
  const draftEngine = async ({ systemPrompt }) => {
    calls.push(systemPrompt.includes('REDACTOR ROMÂN') ? 'rewrite' : 'draft');
    return calls[calls.length - 1] === 'rewrite' ? REWRITE : DRAFT;
  };
  const critiqueEngine = async () => '- „un cap de X" -> „o lovitură de cap a lui X"';
  const { narration, polished } = await polishedNarration({ model: 'opus', userMessage: 'm', draftEngine, critiqueEngine });
  assert.deepEqual(calls, ['draft', 'rewrite']);
  assert.equal(polished, true);
  assert.deepEqual(narration, REWRITE);
});

test('the critique output is injected verbatim into the rewrite system prompt', async () => {
  const seen = [];
  const draftEngine = async ({ systemPrompt }) => { seen.push(systemPrompt); return seen.length === 1 ? DRAFT : REWRITE; };
  const critiqueEngine = async () => 'NOTĂ-UNICAT-DE-TEST';
  await polishedNarration({ model: 'opus', userMessage: 'm', draftEngine, critiqueEngine });
  assert.match(seen[1], /NOTĂ-UNICAT-DE-TEST/);
});

test('the reviewer reads the draft as flat text with ids', async () => {
  let reviewed;
  const draftEngine = async () => DRAFT;
  const critiqueEngine = async ({ userMessage }) => { reviewed = userMessage; return ''; };
  await polishedNarration({ model: 'opus', userMessage: 'm', draftEngine, critiqueEngine });
  assert.match(reviewed, /HEADLINE: Draft cu un cap de McGinn/);
  assert.match(reviewed, /PILL 9001:/);
  assert.match(reviewed, /TONIGHT 9101:/);
});

test('the rewrite is keyed to the original facts, not the lossy review text', async () => {
  const seen = [];
  const draftEngine = async ({ userMessage, systemPrompt }) => {
    seen.push({ userMessage, rewrite: systemPrompt.includes('REDACTOR ROMÂN') });
    return seen.length === 1 ? DRAFT : REWRITE;
  };
  const critiqueEngine = async () => 'note';
  await polishedNarration({ model: 'opus', userMessage: 'FAPTELE-EXACTE', draftEngine, critiqueEngine });
  const rewriteCall = seen.find((c) => c.rewrite);
  assert.equal(rewriteCall.userMessage, 'FAPTELE-EXACTE', 'rewrite re-derives from facts, keeping the facts contract');
});

test('an empty critique ships the draft without burning a rewrite call', async () => {
  let calls = 0;
  const draftEngine = async () => { calls += 1; return DRAFT; };
  const critiqueEngine = async () => '   \n  ';
  const { narration, polished } = await polishedNarration({ model: 'opus', userMessage: 'm', draftEngine, critiqueEngine });
  assert.equal(calls, 1, 'no rewrite call on an empty critique');
  assert.equal(polished, false);
  assert.deepEqual(narration, DRAFT);
});

test('critique failure ships the unpolished draft, polished false', async () => {
  const draftEngine = async () => DRAFT;
  const critiqueEngine = async () => { throw new Error('critique CLI died'); };
  const { narration, polished } = await polishedNarration({ model: 'opus', userMessage: 'm', draftEngine, critiqueEngine });
  assert.equal(polished, false);
  assert.deepEqual(narration, DRAFT);
});

test('rewrite failure ships the unpolished draft, polished false', async () => {
  let n = 0;
  const draftEngine = async () => {
    n += 1;
    if (n === 2) throw new Error('rewrite bad output');
    return DRAFT;
  };
  const critiqueEngine = async () => 'note';
  const { narration, polished } = await polishedNarration({ model: 'opus', userMessage: 'm', draftEngine, critiqueEngine });
  assert.equal(polished, false);
  assert.deepEqual(narration, DRAFT, 'good draft survives a failed rewrite');
});

test('a draft failure propagates (so run.js can fall back to Gemini)', async () => {
  const draftEngine = async () => { const e = new Error('auth failure'); e.auth = true; throw e; };
  const critiqueEngine = async () => 'unused';
  await assert.rejects(
    () => polishedNarration({ model: 'opus', userMessage: 'm', draftEngine, critiqueEngine }),
    /auth failure/,
  );
});

test('buildRewriteSystemPrompt keeps the voice prompt and appends the notes', () => {
  const prompt = buildRewriteSystemPrompt('OBSERVAȚIE-TEST');
  assert.match(prompt, /digestul de dimineață/, 'retains the voice prompt');
  assert.match(prompt, /REDACTOR ROMÂN/);
  assert.match(prompt, /OBSERVAȚIE-TEST/);
});

test('narrationToReviewText lists headline, summary, pills, tonight', () => {
  const text = narrationToReviewText(DRAFT);
  assert.match(text, /HEADLINE: Draft cu un cap de McGinn/);
  assert.match(text, /SUMMARY: Saibari/);
  assert.match(text, /PILL 9001: Poarta intactă/);
  assert.match(text, /TONIGHT 9101: Meci la 5/);
});

test('polishedNarration uses injected EN prompts for draft and critique', async () => {
  const seen = {};
  const draftEngine = async ({ systemPrompt }) => {
    seen.draftSystem = systemPrompt;
    return { headline: 'h', summary: 's', matches: [], tonight: [] };
  };
  const critiqueEngine = async ({ systemPrompt }) => {
    seen.critiqueSystem = systemPrompt;
    return ''; // empty critique → ship draft, no rewrite
  };
  const { narration, polished } = await polishedNarration({
    model: 'm', userMessage: 'facts',
    draftEngine, critiqueEngine,
    systemPrompt: SYSTEM_PROMPT_EN,
    critiquePrompt: CRITIQUE_SYSTEM_PROMPT_EN,
  });
  assert.equal(seen.draftSystem, SYSTEM_PROMPT_EN);
  assert.equal(seen.critiqueSystem, CRITIQUE_SYSTEM_PROMPT_EN);
  assert.equal(narration.headline, 'h');
  assert.equal(polished, false);
});

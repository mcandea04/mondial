import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  narrationSchemaEn, SYSTEM_PROMPT, SYSTEM_PROMPT_EN, CRITIQUE_SYSTEM_PROMPT_EN,
  buildRewriteSystemPromptEn, localizeProse,
  englishVerdict, factsWithEnglishVerdicts,
} from '../pipeline/narration-core.js';

test('narrationSchemaEn accepts the English alarm enum', () => {
  const ok = {
    headline: 'h', summary: 's',
    matches: [{ id: 1, pill: 'p', drama: 3 }],
    tonight: [{ id: 2, alarm: 'worth watching', why: 'w' }],
  };
  assert.doesNotThrow(() => narrationSchemaEn.parse(ok));
});

test('narrationSchemaEn rejects the Romanian alarm enum', () => {
  const bad = {
    headline: 'h', summary: 's', matches: [],
    tonight: [{ id: 2, alarm: 'merită văzut', why: 'w' }],
  };
  assert.throws(() => narrationSchemaEn.parse(bad));
});

test('English prompts are English and reference the alarm enum', () => {
  assert.match(SYSTEM_PROMPT_EN, /English/i);
  assert.match(SYSTEM_PROMPT_EN, /worth watching/);
  assert.match(SYSTEM_PROMPT_EN, /catch it later/);
  assert.match(CRITIQUE_SYSTEM_PROMPT_EN, /English/i);
});

test('prompts route aggregate scorer claims through goalFacts', () => {
  assert.match(SYSTEM_PROMPT, /goalFacts/);
  assert.match(SYSTEM_PROMPT, /dublă/);
  assert.match(SYSTEM_PROMPT_EN, /goalFacts/);
  assert.match(SYSTEM_PROMPT_EN, /brace/);
});

test('buildRewriteSystemPromptEn embeds the critique and the English voice', () => {
  const out = buildRewriteSystemPromptEn('note: avoid "thrilling encounter"');
  assert.match(out, /thrilling encounter/);
  assert.match(out, /English/i);
});

test('localizeProse mirrors the site localize', () => {
  assert.equal(localizeProse('x', 'en'), 'x');
  assert.equal(localizeProse({ ro: 'r', en: 'e' }, 'en'), 'e');
  assert.equal(localizeProse({ ro: 'r' }, 'en'), 'r');
  assert.equal(localizeProse(null, 'ro'), '');
});

test('englishVerdict maps the Romanian alarm enum (incl. legacy) to the English verdict', () => {
  assert.equal(englishVerdict('merită văzut'), 'worth watching');
  assert.equal(englishVerdict('stai treaz'), 'worth watching'); // legacy RO token
  assert.equal(englishVerdict('citești dimineața'), 'catch it later');
  assert.equal(englishVerdict(undefined), 'catch it later'); // safe default
});

test('factsWithEnglishVerdicts injects the canonical verdict per tonight fixture', () => {
  const facts = { tonight: [{ id: 1, home: 'A', away: 'B' }, { id: 2, home: 'C', away: 'D' }] };
  const roNarration = { tonight: [{ id: 1, alarm: 'merită văzut' }, { id: 2, alarm: 'citești dimineața' }] };
  const out = factsWithEnglishVerdicts(facts, roNarration);
  assert.equal(out.tonight[0].verdict, 'worth watching');
  assert.equal(out.tonight[1].verdict, 'catch it later');
  // original facts untouched
  assert.equal(facts.tonight[0].verdict, undefined);
});

test('factsWithEnglishVerdicts defaults to skip for a fixture the RO narration omits', () => {
  const facts = { tonight: [{ id: 9, home: 'X', away: 'Y' }] };
  const out = factsWithEnglishVerdicts(facts, { tonight: [] });
  assert.equal(out.tonight[0].verdict, 'catch it later');
});

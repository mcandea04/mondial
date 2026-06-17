import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  narrationSchemaEn, SYSTEM_PROMPT_EN, CRITIQUE_SYSTEM_PROMPT_EN,
  buildRewriteSystemPromptEn, localizeProse,
} from '../pipeline/narration-core.js';

test('narrationSchemaEn accepts the English alarm enum', () => {
  const ok = {
    headline: 'h', summary: 's',
    matches: [{ id: 1, pill: 'p', drama: 3 }],
    tonight: [{ id: 2, alarm: 'stay up', why: 'w' }],
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
  assert.match(SYSTEM_PROMPT_EN, /stay up/);
  assert.match(SYSTEM_PROMPT_EN, /read in the morning/);
  assert.match(CRITIQUE_SYSTEM_PROMPT_EN, /English/i);
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

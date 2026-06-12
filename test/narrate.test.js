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

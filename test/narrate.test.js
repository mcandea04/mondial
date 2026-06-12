import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUserMessage, normalizeSteer } from '../pipeline/narrate.js';

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

test('an untouched HTML-comment placeholder yields no editor note', () => {
  const message = buildUserMessage(facts, [], '<!-- scrie aici, opțional, ce vrei schimbat -->');
  assert.doesNotMatch(message, /NOTĂ DE LA EDITOR/);
});

test('a note typed alongside the placeholder keeps only the note', () => {
  const message = buildUserMessage(facts, [], '<!-- hint -->\nmai mult sarcasm');
  assert.match(message, /NOTĂ DE LA EDITOR/);
  assert.match(message, /mai mult sarcasm/);
  assert.doesNotMatch(message, /hint/);
});

test('steer combines with recent prose avoidance', () => {
  const message = buildUserMessage(facts, ['glumă veche'], 'fii mai scurt');
  assert.match(message, /glumă veche/);
  assert.match(message, /fii mai scurt/);
});

test('normalizeSteer collapses empty and comment-only input to null', () => {
  assert.equal(normalizeSteer(''), null);
  assert.equal(normalizeSteer(null), null);
  assert.equal(normalizeSteer('   '), null);
  assert.equal(normalizeSteer('<!-- only a comment -->'), null);
  assert.equal(normalizeSteer('real note'), 'real note');
});

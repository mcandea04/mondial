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

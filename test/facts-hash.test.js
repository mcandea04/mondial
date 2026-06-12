import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factsHash } from '../pipeline/facts-hash.js';

const base = {
  date: '2026-06-12',
  finished: [
    { id: 2, home: 'Canada', away: 'Qatar', score: [4, 0], scorers: ['Davies 12'], group: 'B', utcDate: '2026-06-12T02:00:00Z' },
    { id: 1, home: 'Mexic', away: 'Africa de Sud', score: [1, 0], scorers: ['Lozano 88'], group: 'A', utcDate: '2026-06-11T19:00:00Z' },
  ],
  tonight: [{ id: 3, home: 'Brazilia', away: 'Maroc', kickoffEEST: '21:00', utcDate: '2026-06-12T18:00:00Z' }],
  standings: [
    { name: 'B', table: [{ team: 'Canada', pts: 3 }] },
    { name: 'A', table: [{ team: 'Mexic', pts: 3 }] },
  ],
};

test('hash is stable for identical input', () => {
  assert.equal(factsHash(base), factsHash(structuredClone(base)));
});

test('object key order does not change the hash', () => {
  const reordered = structuredClone(base);
  reordered.finished[1] = { utcDate: '2026-06-11T19:00:00Z', group: 'A', scorers: ['Lozano 88'], score: [1, 0], away: 'Africa de Sud', home: 'Mexic', id: 1 };
  assert.equal(factsHash(base), factsHash(reordered));
});

test('array order of matches does not change the hash', () => {
  const reordered = structuredClone(base);
  reordered.finished.reverse();
  assert.equal(factsHash(base), factsHash(reordered));
});

test('a changed score changes the hash', () => {
  const corrected = structuredClone(base);
  corrected.finished[0].score = [4, 1];
  assert.notEqual(factsHash(base), factsHash(corrected));
});

test('a changed standings table does NOT change the hash', () => {
  const shifted = structuredClone(base);
  shifted.standings[0].table[0].pts = 6;
  assert.equal(factsHash(base), factsHash(shifted));
});

test('a late scorer name does NOT change the hash', () => {
  const withScorer = structuredClone(base);
  withScorer.finished[0].scorers.push('Buchanan 90+2');
  assert.equal(factsHash(base), factsHash(withScorer));
});

test('a changed tonight kickoff changes the hash', () => {
  const moved = structuredClone(base);
  moved.tonight[0].kickoffEEST = '22:00';
  assert.notEqual(factsHash(base), factsHash(moved));
});

test('a changed date changes the hash', () => {
  assert.notEqual(factsHash(base), factsHash({ ...base, date: '2026-06-13' }));
});

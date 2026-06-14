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

// Richer projection: scorers (with manner/assist) and dismissals (with reason)
// are now drama facts in the hash; stats are deliberately excluded.
const rich = {
  date: '2026-06-12',
  finished: [
    {
      id: 1,
      home: 'Mexic',
      away: 'Africa de Sud',
      score: [2, 1],
      scorers: [
        { name: 'Lozano', minute: '88', team: 'home', penalty: false, ownGoal: false, assist: null, bodyPart: null, placement: null },
        { name: 'Giménez', minute: '12', team: 'home', penalty: false, ownGoal: false, assist: null, bodyPart: null, placement: null },
      ],
      events: [{ name: 'Mokoena', minute: '79', team: 'away', reason: null }],
      stats: { home: { possessionPct: '55.0' }, away: { possessionPct: '45.0' } },
      group: 'A',
      utcDate: '2026-06-11T19:00:00Z',
    },
  ],
  tonight: [{ id: 3, home: 'Brazilia', away: 'Maroc', kickoffEEST: '21:00', utcDate: '2026-06-12T18:00:00Z' }],
  standings: [],
};

test('adding a scorer changes the hash (new narration material)', () => {
  const extra = structuredClone(rich);
  extra.finished[0].scorers.push({ name: 'Buchanan', minute: '90+2', team: 'home', penalty: false, ownGoal: false, assist: null, bodyPart: null, placement: null });
  assert.notEqual(factsHash(rich), factsHash(extra));
});

test('a late assist or card reason changes the hash', () => {
  const withAssist = structuredClone(rich);
  withAssist.finished[0].scorers[0].assist = 'Giménez';
  assert.notEqual(factsHash(rich), factsHash(withAssist));

  const withReason = structuredClone(rich);
  withReason.finished[0].events[0].reason = 'pentru un fault dur';
  assert.notEqual(factsHash(rich), factsHash(withReason));
});

test('reordering scorers does NOT change the hash', () => {
  const reordered = structuredClone(rich);
  reordered.finished[0].scorers.reverse();
  assert.equal(factsHash(rich), factsHash(reordered));
});

test('a changed stat does NOT change the hash (stats excluded from projection)', () => {
  const shifted = structuredClone(rich);
  shifted.finished[0].stats.home.possessionPct = '60.0';
  assert.equal(factsHash(rich), factsHash(shifted));
});

test('a changed tonight kickoff changes the hash', () => {
  const moved = structuredClone(base);
  moved.tonight[0].kickoffEEST = '22:00';
  assert.notEqual(factsHash(base), factsHash(moved));
});

test('a changed date changes the hash', () => {
  assert.notEqual(factsHash(base), factsHash({ ...base, date: '2026-06-13' }));
});

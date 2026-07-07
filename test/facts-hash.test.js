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

test('a late assist, bodyPart, placement, or card reason does NOT change the hash', () => {
  const withAssist = structuredClone(rich);
  withAssist.finished[0].scorers[0].assist = 'Giménez';
  assert.equal(factsHash(rich), factsHash(withAssist));

  const withBodyPart = structuredClone(rich);
  withBodyPart.finished[0].scorers[0].bodyPart = 'cap';
  assert.equal(factsHash(rich), factsHash(withBodyPart));

  const withPlacement = structuredClone(rich);
  withPlacement.finished[0].scorers[0].placement = 'colțul lung';
  assert.equal(factsHash(rich), factsHash(withPlacement));

  const withReason = structuredClone(rich);
  withReason.finished[0].events[0].reason = 'pentru un fault dur';
  assert.equal(factsHash(rich), factsHash(withReason));
});

test('reordering scorers does NOT change the hash', () => {
  const reordered = structuredClone(rich);
  reordered.finished[0].scorers.reverse();
  assert.equal(factsHash(rich), factsHash(reordered));
});

test('a changed scorer name changes the hash', () => {
  const renamed = structuredClone(rich);
  renamed.finished[0].scorers[0].name = 'Jiménez';
  assert.notEqual(factsHash(rich), factsHash(renamed));
});

test('a changed scorer team changes the hash', () => {
  const flipped = structuredClone(rich);
  flipped.finished[0].scorers[0].team = 'away';
  assert.notEqual(factsHash(rich), factsHash(flipped));
});

test('a flipped penalty flag changes the hash', () => {
  const pen = structuredClone(rich);
  pen.finished[0].scorers[0].penalty = true;
  assert.notEqual(factsHash(rich), factsHash(pen));
});

test('a flipped ownGoal flag changes the hash', () => {
  const og = structuredClone(rich);
  og.finished[0].scorers[0].ownGoal = true;
  assert.notEqual(factsHash(rich), factsHash(og));
});

test('removing a red card changes the hash', () => {
  const noCard = structuredClone(rich);
  noCard.finished[0].events = [];
  assert.notEqual(factsHash(rich), factsHash(noCard));
});

test('two same-minute goals differing by a flag hash the same regardless of input order', () => {
  const a = { name: 'A', minute: '45', team: 'home', penalty: true, ownGoal: false, assist: null, bodyPart: null, placement: null };
  const b = { name: 'A', minute: '45', team: 'home', penalty: false, ownGoal: false, assist: null, bodyPart: null, placement: null };
  const forward = structuredClone(rich);
  forward.finished[0].scorers = [a, b];
  const backward = structuredClone(rich);
  backward.finished[0].scorers = [b, a];
  assert.equal(factsHash(forward), factsHash(backward));
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

test('knockout stage and result fields change the hash', () => {
  const knockout = structuredClone(base);
  knockout.finished[0].stage = 'round-of-32';
  knockout.finished[0].winnerAdvancesTo = 'round-of-16';
  knockout.finished[0].winner = 'Canada';
  knockout.finished[0].loser = 'Qatar';
  knockout.finished[0].winnerSide = 'home';
  knockout.finished[0].loserSide = 'away';
  assert.notEqual(factsHash(base), factsHash(knockout));

  const moved = structuredClone(base);
  moved.tonight[0].stage = 'round-of-32';
  moved.tonight[0].winnerAdvancesTo = 'round-of-16';
  assert.notEqual(factsHash(base), factsHash(moved));
});

test('a changed knockout destination changes the hash', () => {
  const a = structuredClone(base);
  const b = structuredClone(base);
  a.finished[0].stage = b.finished[0].stage = 'round-of-16';
  a.finished[0].winnerAdvancesTo = 'quarterfinal';
  b.finished[0].winnerAdvancesTo = 'semifinal';
  assert.notEqual(factsHash(a), factsHash(b));
});

test('knockout decision details change the hash', () => {
  const knockout = structuredClone(base);
  Object.assign(knockout.finished[0], {
    stage: 'round-of-32',
    winnerAdvancesTo: 'round-of-16',
    winner: 'Canada',
    loser: 'Qatar',
    winnerSide: 'home',
    loserSide: 'away',
    score: [1, 1],
    decidedAfter: 'penalties',
    penalties: [4, 2],
  });

  const flippedSides = structuredClone(knockout);
  flippedSides.finished[0].winnerSide = 'away';
  flippedSides.finished[0].loserSide = 'home';
  assert.notEqual(factsHash(knockout), factsHash(flippedSides));

  const correctedPens = structuredClone(knockout);
  correctedPens.finished[0].penalties = [5, 3];
  assert.notEqual(factsHash(knockout), factsHash(correctedPens));

  const afterExtraTime = structuredClone(knockout);
  afterExtraTime.finished[0].decidedAfter = 'extraTime';
  afterExtraTime.finished[0].penalties = null;
  assert.notEqual(factsHash(knockout), factsHash(afterExtraTime));
});

test('changed preview metadata changes the hash', () => {
  const immediate = { ...structuredClone(base), preview: { digestDate: '2026-06-13', restNights: 0 } };
  const afterRest = { ...structuredClone(base), preview: { digestDate: '2026-06-14', restNights: 1 } };
  assert.notEqual(factsHash(immediate), factsHash(afterRest));
});

test('a changed date changes the hash', () => {
  assert.notEqual(factsHash(base), factsHash({ ...base, date: '2026-06-13' }));
});

test('FIFA ranks on matches and standings do NOT change the hash (freeze-safe)', () => {
  const ranked = structuredClone(base);
  ranked.finished[0].homeRank = 30;
  ranked.finished[0].awayRank = 56;
  ranked.finished[1].homeRank = 14;
  ranked.finished[1].awayRank = 60;
  ranked.tonight[0].homeRank = 6;
  ranked.tonight[0].awayRank = 7;
  ranked.standings[0].table[0].rank = 30;
  assert.equal(factsHash(base), factsHash(ranked));
});

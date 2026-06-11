import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  nightWindow,
  isInNightWindow,
  kickoffEEST,
  selectDigestMatches,
  parseMatch,
  parseStandings,
} from '../pipeline/fetch.js';

test('night window for a summer digest date spans 16:00 UTC to 06:00 UTC', () => {
  const { start, end } = nightWindow('2026-06-12');
  assert.equal(start.toISOString(), '2026-06-11T16:00:00.000Z');
  assert.equal(end.toISOString(), '2026-06-12T06:00:00.000Z');
});

test('window boundaries: start inclusive, end exclusive', () => {
  const window = nightWindow('2026-06-12');
  assert.equal(isInNightWindow('2026-06-11T16:00:00Z', window), true);
  assert.equal(isInNightWindow('2026-06-12T05:59:00Z', window), true);
  assert.equal(isInNightWindow('2026-06-12T06:00:00Z', window), false);
  assert.equal(isInNightWindow('2026-06-11T15:59:00Z', window), false);
});

test('kickoff EEST conversion (summer = UTC+3)', () => {
  assert.equal(kickoffEEST('2026-06-11T19:00:00Z'), '22:00');
  assert.equal(kickoffEEST('2026-06-12T02:00:00Z'), '05:00');
});

test('kickoff EET conversion (winter = UTC+2, no hardcoded offset)', () => {
  assert.equal(kickoffEEST('2026-01-15T19:00:00Z'), '21:00');
});

test('selectDigestMatches splits finished night games from tonight fixtures', () => {
  const response = {
    matches: [
      // last night, finished → "finished"
      { id: 1, status: 'FINISHED', utcDate: '2026-06-11T19:00:00Z' },
      // tonight → "tonight"
      { id: 2, status: 'TIMED', utcDate: '2026-06-12T19:00:00Z' },
      // tomorrow night early hours → "tonight" (still next window)
      { id: 3, status: 'TIMED', utcDate: '2026-06-13T02:00:00Z' },
      // afternoon game outside both windows → dropped
      { id: 4, status: 'TIMED', utcDate: '2026-06-12T12:00:00Z' },
      // last night but not finished (postponed) → dropped from finished
      { id: 5, status: 'POSTPONED', utcDate: '2026-06-11T19:00:00Z' },
    ],
  };
  const { finished, tonight } = selectDigestMatches(response, '2026-06-12');
  assert.deepEqual(finished.map((m) => m.id), [1]);
  assert.deepEqual(tonight.map((m) => m.id), [2, 3]);
});

test('parseMatch with full detail: scorers, red cards, penalties', () => {
  const match = {
    id: 9,
    group: 'GROUP_E',
    utcDate: '2026-06-11T19:00:00Z',
    homeTeam: { name: 'Germania' },
    awayTeam: { name: 'Japonia' },
    score: { fullTime: { home: 1, away: 2 }, penalties: null },
    goals: [
      { minute: 33, scorer: { name: 'Gnabry' } },
      { minute: 75, scorer: { name: 'Doan' } },
    ],
    bookings: [
      { minute: 79, card: 'RED', player: { name: 'Rüdiger' } },
      { minute: 50, card: 'YELLOW', player: { name: 'Kimmich' } },
    ],
  };
  const parsed = parseMatch(match);
  assert.deepEqual(parsed.score, [1, 2]);
  assert.deepEqual(parsed.scorers, ["Gnabry 33'", "Doan 75'"]);
  assert.deepEqual(parsed.events, ["roșu Rüdiger 79'"]);
  assert.equal(parsed.group, 'E');
});

test('parseMatch degrades gracefully without goals/bookings detail', () => {
  const match = {
    id: 9,
    group: 'GROUP_A',
    utcDate: '2026-06-11T19:00:00Z',
    homeTeam: { name: 'Mexic' },
    awayTeam: { name: 'Africa de Sud' },
    score: { fullTime: { home: 2, away: 0 } },
  };
  const parsed = parseMatch(match);
  assert.deepEqual(parsed.score, [2, 0]);
  assert.deepEqual(parsed.scorers, []);
  assert.deepEqual(parsed.events, []);
});

test('parseStandings maps the live API shape into group tables', async () => {
  const response = JSON.parse(
    await readFile(new URL('./fixtures/live-standings-sample.json', import.meta.url), 'utf8'),
  );
  const groups = parseStandings(response);
  assert.equal(groups.length, 12);
  assert.equal(groups[0].name, 'A');
  assert.equal(groups[0].table.length, 4);
  const row = groups[0].table[0];
  for (const key of ['team', 'p', 'gd', 'pts']) {
    assert.ok(key in row, `missing ${key}`);
  }
});

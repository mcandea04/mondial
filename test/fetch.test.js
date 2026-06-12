import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  nightWindow,
  isInNightWindow,
  kickoffEEST,
  activeDigestDate,
  digestReadiness,
  selectDigestMatches,
  parseMatch,
  parseFixture,
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

test('activeDigestDate: poll in the evening belongs to the next morning', () => {
  // 21:00 UTC (00:00 EEST) on the 11th → digest dated the 12th.
  assert.equal(activeDigestDate(new Date('2026-06-11T21:00:00Z')), '2026-06-12');
  // 16:00 UTC exactly: window start, rolls to next day.
  assert.equal(activeDigestDate(new Date('2026-06-11T16:00:00Z')), '2026-06-12');
  // Morning poll at 04:30 UTC on the 12th → digest dated the 12th.
  assert.equal(activeDigestDate(new Date('2026-06-12T04:30:00Z')), '2026-06-12');
  // Just before the 16:00 boundary still belongs to the same calendar day's digest.
  assert.equal(activeDigestDate(new Date('2026-06-12T15:59:00Z')), '2026-06-12');
});

test('digestReadiness: not ready while any match is still pending', () => {
  const matches = [
    { status: 'FINISHED' },
    { status: 'IN_PLAY' },
  ];
  const r = digestReadiness(matches);
  assert.equal(r.ready, false);
});

test('digestReadiness: ready once every match is terminal with at least one finished', () => {
  const matches = [
    { status: 'FINISHED' },
    { status: 'FINISHED' },
  ];
  assert.equal(digestReadiness(matches).ready, true);
});

test('digestReadiness: knockout still in extra time / penalties is not finished', () => {
  // The API keeps a match non-FINISHED through ET and the shootout.
  assert.equal(digestReadiness([{ status: 'PAUSED' }]).ready, false);
  assert.equal(digestReadiness([{ status: 'IN_PLAY' }]).ready, false);
});

test('digestReadiness: postponed/cancelled do not block, but cannot stand alone', () => {
  // One real game finished, another postponed → ready (postponed never blocks).
  assert.equal(
    digestReadiness([{ status: 'FINISHED' }, { status: 'POSTPONED' }]).ready,
    true,
  );
  // Only postponed/cancelled, nothing actually played → not ready.
  assert.equal(
    digestReadiness([{ status: 'POSTPONED' }, { status: 'CANCELLED' }]).ready,
    false,
  );
});

test('digestReadiness: empty night is not ready', () => {
  assert.equal(digestReadiness([]).ready, false);
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

test('team names are translated to Romanian throughout', () => {
  const match = {
    id: 1,
    group: 'GROUP_A',
    utcDate: '2026-06-11T19:00:00Z',
    homeTeam: { name: 'Mexico' },
    awayTeam: { name: 'South Africa' },
    score: { fullTime: { home: 2, away: 1 } },
  };
  const parsed = parseMatch(match);
  assert.equal(parsed.home, 'Mexic');
  assert.equal(parsed.away, 'Africa de Sud');

  const standings = parseStandings({
    standings: [{
      type: 'TOTAL',
      group: 'Group B',
      table: [
        { team: { name: 'Switzerland' }, playedGames: 0, won: 0, draw: 0, lost: 0, goalDifference: 0, points: 0 },
      ],
    }],
  });
  assert.equal(standings[0].table[0].team, 'Elveția');
});

test('unknown team names (knockout placeholders) pass through unchanged', () => {
  const match = {
    id: 2,
    utcDate: '2026-07-01T19:00:00Z',
    homeTeam: { name: 'Winner Group A' },
    awayTeam: { name: 'Runner-up Group B' },
    score: { fullTime: { home: null, away: null } },
  };
  const parsed = parseMatch(match);
  assert.equal(parsed.home, 'Winner Group A');
  assert.equal(parsed.away, 'Runner-up Group B');
});

test('parseMatch with full detail: team-attributed scorers, red cards, minutes without apostrophe', () => {
  const match = {
    id: 9,
    group: 'GROUP_E',
    utcDate: '2026-06-11T19:00:00Z',
    homeTeam: { name: 'Germania' },
    awayTeam: { name: 'Japonia' },
    score: { fullTime: { home: 1, away: 2 }, penalties: null },
    goals: [
      { minute: '33', scorer: { name: 'Gnabry' }, team: 'home' },
      { minute: '90+2', scorer: { name: 'Doan' }, team: 'away' },
    ],
    bookings: [
      { minute: '79', card: 'RED', player: { name: 'Rüdiger' }, team: 'home' },
      { minute: '50', card: 'YELLOW', player: { name: 'Kimmich' }, team: 'home' },
      { minute: '88', card: 'YELLOW_RED', player: { name: 'Endo' }, team: 'away' },
    ],
  };
  const parsed = parseMatch(match);
  assert.deepEqual(parsed.score, [1, 2]);
  assert.deepEqual(parsed.scorers, [
    { name: 'Gnabry', minute: '33', team: 'home' },
    { name: 'Doan', minute: '90+2', team: 'away' },
  ]);
  assert.deepEqual(parsed.events, [
    { name: 'Rüdiger', minute: '79', team: 'home' },
    { name: 'Endo', minute: '88', team: 'away' },
  ]);
  assert.equal(parsed.decidedOnPenalties, false);
  assert.equal(parsed.group, 'E');
});

test('parseMatch sets decidedOnPenalties and keeps it out of events', () => {
  const match = {
    id: 10,
    group: 'GROUP_E',
    utcDate: '2026-06-11T19:00:00Z',
    homeTeam: { name: 'Germania' },
    awayTeam: { name: 'Japonia' },
    score: { fullTime: { home: 1, away: 1 }, penalties: { home: 4, away: 3 } },
    bookings: [{ minute: '70', card: 'RED', player: { name: 'X' }, team: 'home' }],
  };
  const parsed = parseMatch(match);
  assert.equal(parsed.decidedOnPenalties, true);
  assert.deepEqual(parsed.events, [{ name: 'X', minute: '70', team: 'home' }]);
});

test('parseMatch leaves team null when goals/bookings carry no team (offline fixtures)', () => {
  const match = {
    id: 11,
    group: 'GROUP_A',
    utcDate: '2026-06-11T19:00:00Z',
    homeTeam: { name: 'Mexic' },
    awayTeam: { name: 'Africa de Sud' },
    score: { fullTime: { home: 1, away: 0 } },
    goals: [{ minute: '9', scorer: { name: 'Quiñones' } }],
    bookings: [{ minute: '49', card: 'RED', player: { name: 'Sithole' } }],
  };
  const parsed = parseMatch(match);
  assert.deepEqual(parsed.scorers, [{ name: 'Quiñones', minute: '9', team: null }]);
  assert.deepEqual(parsed.events, [{ name: 'Sithole', minute: '49', team: null }]);
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
  assert.equal(parsed.decidedOnPenalties, false);
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

test('parseMatch attaches home/away flag codes from English names', () => {
  const match = {
    id: 1,
    homeTeam: { name: 'Mexico' },
    awayTeam: { name: 'South Africa' },
    score: { fullTime: { home: 2, away: 1 } },
    group: 'GROUP_A',
    utcDate: '2026-06-11T19:00:00Z',
  };
  const parsed = parseMatch(match);
  assert.equal(parsed.homeCode, 'mx');
  assert.equal(parsed.awayCode, 'za');
});

test('parseMatch leaves codes null for knockout placeholder names', () => {
  const match = {
    id: 2,
    homeTeam: { name: 'Winner Group A' },
    awayTeam: { name: 'Runner-up Group B' },
    score: { fullTime: { home: 0, away: 0 } },
    utcDate: '2026-07-01T19:00:00Z',
  };
  const parsed = parseMatch(match);
  assert.equal(parsed.homeCode, null);
  assert.equal(parsed.awayCode, null);
});

test('parseFixture attaches home/away flag codes', () => {
  const fixture = {
    id: 3,
    homeTeam: { name: 'Brazil' },
    awayTeam: { name: 'Morocco' },
    group: 'GROUP_C',
    utcDate: '2026-06-12T19:00:00Z',
  };
  const parsed = parseFixture(fixture);
  assert.equal(parsed.homeCode, 'br');
  assert.equal(parsed.awayCode, 'ma');
});

test('parseStandings attaches a flag code per row from the English name', () => {
  const response = {
    standings: [
      {
        type: 'TOTAL',
        group: 'Group A',
        table: [
          { team: { name: 'Mexico' }, playedGames: 1, won: 1, draw: 0, lost: 0, goalDifference: 2, points: 3 },
          { team: { name: 'South Korea' }, playedGames: 1, won: 1, draw: 0, lost: 0, goalDifference: 1, points: 3 },
        ],
      },
    ],
  };
  const [group] = parseStandings(response);
  assert.equal(group.table[0].code, 'mx');
  assert.equal(group.table[1].code, 'kr');
});

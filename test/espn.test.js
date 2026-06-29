import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  nightWindow,
  isInNightWindow,
  kickoffEEST,
  activeDigestDate,
  isOver,
} from '../pipeline/espn.js';

test('night window for a summer digest date spans 16:00 UTC to 06:00 UTC', () => {
  const { start, end } = nightWindow('2026-06-12');
  assert.equal(start.toISOString(), '2026-06-11T16:00:00.000Z');
  assert.equal(end.toISOString(),   '2026-06-12T06:00:00.000Z');
});

test('window boundaries: start inclusive, end exclusive', () => {
  const w = nightWindow('2026-06-12');
  assert.equal(isInNightWindow('2026-06-11T16:00:00Z', w), true);
  assert.equal(isInNightWindow('2026-06-12T05:59:00Z', w), true);
  assert.equal(isInNightWindow('2026-06-12T06:00:00Z', w), false);
  assert.equal(isInNightWindow('2026-06-11T15:59:00Z', w), false);
});

test('kickoffEEST converts UTC to EEST correctly (summer UTC+3)', () => {
  assert.equal(kickoffEEST('2026-06-11T19:00:00Z'), '22:00');
  assert.equal(kickoffEEST('2026-06-12T02:00:00Z'), '05:00');
});

test('activeDigestDate: poll at 21:00 UTC belongs to the next day', () => {
  assert.equal(activeDigestDate(new Date('2026-06-11T21:00:00Z')), '2026-06-12');
  assert.equal(activeDigestDate(new Date('2026-06-11T16:00:00Z')), '2026-06-12');
  assert.equal(activeDigestDate(new Date('2026-06-12T04:30:00Z')), '2026-06-12');
  assert.equal(activeDigestDate(new Date('2026-06-12T15:59:00Z')), '2026-06-12');
});

test('isOver is true only when ESPN nests status.type.completed===true', () => {
  assert.equal(isOver({ status: { type: { completed: true,  state: 'post' } } }), true);
  assert.equal(isOver({ status: { type: { completed: false, state: 'post' } } }), false);
  assert.equal(isOver({ status: { type: { state: 'in' } } }), false);
  assert.equal(isOver({}), false);
  // Real ESPN has NO top-level `completed`; a stray top-level flag must not count.
  assert.equal(isOver({ completed: true }), false);
});

import {
  parseMatch,
  parseFixture,
  parseStandings,
  scoreboardDates,
  stageFromEvent,
  nextStage,
} from '../pipeline/espn.js';

test('scoreboardDates returns both the UTC date and the day before (ET buckets)', () => {
  // 02:00 UTC = previous evening ET
  const dates = scoreboardDates('2026-06-12T02:00:00Z');
  assert.ok(dates.includes('20260611'), 'should include prev ET day');
  assert.ok(dates.includes('20260612'), 'should include UTC day');
  assert.equal(dates.length, 2);
  // 19:00 UTC = same calendar day ET
  const same = scoreboardDates('2026-06-11T19:00:00Z');
  assert.equal(same.length, 1);
  assert.ok(same.includes('20260611'));
});

test('parseMatch maps an ESPN-shaped completed event to the FD output shape', () => {
  const event = {
    id: '760414',
    date: '2026-06-11T19:00:00Z',
    status: { type: { state: 'post', completed: true } },
    competitions: [{ competitors: [
      { homeAway: 'home', score: '2', team: { id: '203', displayName: 'Mexico' } },
      { homeAway: 'away', score: '1', team: { id: '467', displayName: 'South Africa' } },
    ] }],
    goals: [],
    bookings: [],
    matchStats: null,
  };
  const parsed = parseMatch(event, 'A');
  assert.equal(parsed.id, 760414);
  assert.equal(parsed.home, 'Mexic');
  assert.equal(parsed.away, 'Africa de Sud');
  assert.equal(parsed.homeCode, 'mx');
  assert.equal(parsed.awayCode, 'za');
  assert.deepEqual(parsed.score, [2, 1]);
  assert.equal(parsed.group, 'A');
  assert.equal(parsed.decidedOnPenalties, false);
  assert.equal(parsed.stats, null);
});

test('parseMatch leaves score [null, null] when score strings are absent', () => {
  const event = {
    id: '760999',
    date: '2026-06-12T19:00:00Z',
    status: { type: { state: 'pre', completed: false } },
    competitions: [{ competitors: [
      { homeAway: 'home', team: { id: '1', displayName: 'Brazil' } },
      { homeAway: 'away', team: { id: '2', displayName: 'Morocco' } },
    ] }],
    goals: [],
    bookings: [],
    matchStats: null,
  };
  const parsed = parseMatch(event, 'C');
  assert.deepEqual(parsed.score, [null, null]);
});

test('parseFixture maps a not-yet-played ESPN event to the fixture shape', () => {
  const event = {
    id: '760416',
    date: '2026-06-12T19:00:00Z',
    competitions: [{ competitors: [
      { homeAway: 'home', team: { id: '20', displayName: 'Brazil' } },
      { homeAway: 'away', team: { id: '21', displayName: 'Morocco' } },
    ] }],
  };
  const parsed = parseFixture(event, 'C');
  assert.equal(parsed.id, 760416);
  assert.equal(parsed.home, 'Brazilia');
  assert.equal(parsed.homeCode, 'br');
  assert.ok(parsed.kickoffEEST);
  assert.equal(parsed.group, 'C');
});

test('stageFromEvent normalizes ESPN round-of-32 metadata', () => {
  assert.equal(stageFromEvent({ season: { slug: 'round-of-32' } }), 'round-of-32');
  assert.equal(stageFromEvent({ season: { name: '2026 FIFA World Cup, Round of 32' } }), 'round-of-32');
  assert.equal(stageFromEvent({ season: { type: 13801 } }), 'round-of-32');
});

test('nextStage maps the full knockout progression', () => {
  assert.equal(nextStage('round-of-32'), 'round-of-16');
  assert.equal(nextStage('round-of-16'), 'quarterfinal');
  assert.equal(nextStage('quarterfinal'), 'semifinal');
  assert.equal(nextStage('semifinal'), 'final');
  assert.equal(nextStage('final'), 'champion');
  assert.equal(nextStage('group-stage'), null);
});

test('parseMatch publishes knockout stage and winner/loser facts', () => {
  const event = {
    id: '760486',
    date: '2026-06-28T19:00:00Z',
    season: { slug: 'round-of-32' },
    status: { type: { state: 'post', completed: true } },
    competitions: [{ competitors: [
      { homeAway: 'home', score: '0', winner: false, team: { id: '467', displayName: 'South Africa' } },
      { homeAway: 'away', score: '1', winner: true, team: { id: '206', displayName: 'Canada' } },
    ] }],
    goals: [],
    bookings: [],
    matchStats: null,
  };
  const parsed = parseMatch(event, null);
  assert.equal(parsed.group, null);
  assert.equal(parsed.stage, 'round-of-32');
  assert.equal(parsed.winnerAdvancesTo, 'round-of-16');
  assert.equal(parsed.winner, 'Canada');
  assert.equal(parsed.loser, 'Africa de Sud');
  assert.equal(parsed.winnerSide, 'away');
  assert.equal(parsed.loserSide, 'home');
});

test('parseFixture publishes knockout stage metadata', () => {
  const event = {
    id: '760487',
    date: '2026-06-29T17:00:00Z',
    season: { slug: 'round-of-32' },
    competitions: [{ competitors: [
      { homeAway: 'home', team: { id: '20', displayName: 'Brazil' } },
      { homeAway: 'away', team: { id: '21', displayName: 'Japan' } },
    ] }],
  };
  const parsed = parseFixture(event, null);
  assert.equal(parsed.group, null);
  assert.equal(parsed.stage, 'round-of-32');
  assert.equal(parsed.winnerAdvancesTo, 'round-of-16');
});

test('parseStandings maps ESPN children into group tables', async () => {
  const raw = JSON.parse(
    await readFile(new URL('./fixtures/espn-standings.json', import.meta.url), 'utf8'),
  );
  const groups = parseStandings(raw);
  assert.equal(groups[0].name, 'A');
  const row = groups[0].table[0];
  assert.equal(row.team, 'Mexic');
  assert.equal(row.code, 'mx');
  assert.equal(row.p, 1);
  assert.equal(row.pts, 3);
  assert.equal(row.gd, 1);
});

test('parseStandings orders each table by points then goal difference', async () => {
  const raw = {
    children: [{
      name: 'Group Z',
      standings: { entries: [
        { team: { displayName: 'Brazil' }, stats: [{ name: 'points', value: 1 }, { name: 'pointDifferential', value: 0 }] },
        { team: { displayName: 'Germany' }, stats: [{ name: 'points', value: 3 }, { name: 'pointDifferential', value: 2 }] },
        { team: { displayName: 'Spain' }, stats: [{ name: 'points', value: 3 }, { name: 'pointDifferential', value: 1 }] },
        { team: { displayName: 'Japan' }, stats: [{ name: 'points', value: 0 }, { name: 'pointDifferential', value: -3 }] },
      ] },
    }],
  };
  const [group] = parseStandings(raw);
  assert.deepEqual(group.table.map((r) => r.pts), [3, 3, 1, 0]);
  assert.deepEqual(group.table.map((r) => r.gd), [2, 1, 0, -3]);
});

import {
  parseGoalManner,
  parseCardReason,
  eventsToFootballData,
  teamStats,
} from '../pipeline/espn.js';

test('team aliases resolve: Türkiye, Korea Republic, Cape Verde', () => {
  const event = {
    id: '1',
    date: '2026-06-11T19:00:00Z',
    status: { type: { state: 'post', completed: true } },
    competitions: [{ competitors: [
      { homeAway: 'home', score: '1', team: { id: '5', displayName: 'Türkiye' } },
      { homeAway: 'away', score: '0', team: { id: '6', displayName: 'Korea Republic' } },
    ] }],
    goals: [], bookings: [], matchStats: null,
  };
  const parsed = parseMatch(event, 'D');
  assert.equal(parsed.home, 'Turcia');
  assert.equal(parsed.homeCode, 'tr');
  assert.equal(parsed.away, 'Coreea de Sud');
  assert.equal(parsed.awayCode, 'kr');
});

test('parseGoalManner maps body part and placement to Romanian tokens', () => {
  assert.deepEqual(
    parseGoalManner('right footed shot from outside the box'),
    { bodyPart: 'dreptul', placement: 'din afara careului' },
  );
  assert.deepEqual(
    parseGoalManner('Left footed shot from the centre of the box.'),
    { bodyPart: 'stângul', placement: 'din careu' },
  );
  assert.deepEqual(parseGoalManner('Header from the left side of the box.'), {
    bodyPart: 'cu capul', placement: 'din stânga careului',
  });
  assert.equal(parseGoalManner('Right footed shot from the right side of the box.').placement, 'din dreapta careului');
  assert.equal(parseGoalManner('Scored direct free kick.').placement, 'din lovitură liberă');
  assert.equal(parseGoalManner('Finished with the head.').bodyPart, 'cu capul');
  assert.deepEqual(parseGoalManner('unknown text'), {});
});

test('parseCardReason maps known reasons and returns null otherwise', () => {
  assert.equal(parseCardReason('Player is shown the yellow card for a bad foul.'), 'pentru un fault dur');
  assert.equal(parseCardReason('Player is shown the red card for a professional foul.'), 'pentru fault tactic');
  assert.equal(parseCardReason('Player is shown the yellow card for dissent.'), 'pentru proteste');
  assert.equal(parseCardReason('Player is shown the yellow card.'), null);
  assert.equal(parseCardReason('Player is shown the yellow card for time-wasting.'), null);
});

test('eventsToFootballData maps scoring plays to goals with scorer, minute, and team', () => {
  const keyEvents = [
    { team: { id: '203' }, clock: { displayValue: "9'" }, type: { id: '70', text: 'Goal' }, scoringPlay: true, participants: [{ athlete: { displayName: 'Quiñones' } }, { athlete: { displayName: 'Lira' } }] },
    { team: { id: '467' }, clock: { displayValue: "67'" }, type: { id: '137', text: 'Goal - Header' }, scoringPlay: true, participants: [{ athlete: { displayName: 'Jiménez' } }] },
  ];
  const map = { '203': 'home', '467': 'away' };
  const { goals } = eventsToFootballData(keyEvents, map);
  assert.deepEqual(goals, [
    { minute: '9', scorer: { name: 'Quiñones' }, team: 'home', penalty: false, ownGoal: false, assist: 'Lira' },
    { minute: '67', scorer: { name: 'Jiménez' }, team: 'away', penalty: false, ownGoal: false, assist: null },
  ]);
});

test('eventsToFootballData: penalty flag, own goal, no assist for those types', () => {
  const { goals: pen } = eventsToFootballData(
    [{ team: { id: '1' }, clock: { displayValue: "45'" }, type: { text: 'Penalty - Scored' }, scoringPlay: true, participants: [{ athlete: { displayName: 'Embolo' } }] }],
    { '1': 'home' },
  );
  assert.equal(pen[0].penalty, true);
  assert.equal(pen[0].assist, null);

  const { goals: og } = eventsToFootballData(
    [{ team: { id: '1' }, clock: { displayValue: "60'" }, type: { text: 'Own Goal' }, scoringPlay: true, participants: [{ athlete: { displayName: 'Muheim' } }, { athlete: { displayName: 'Ahmed' } }] }],
    { '1': 'home' },
  );
  assert.equal(og[0].ownGoal, true);
  assert.equal(og[0].assist, null);
});

test('eventsToFootballData: bookings carry reason or null; yellow included', () => {
  const { bookings } = eventsToFootballData(
    [
      { team: { id: '1' }, clock: { displayValue: "17'" }, type: { text: 'Red Card' }, scoringPlay: false, participants: [{ athlete: { displayName: 'A' } }], text: 'A is shown the red card for a bad foul.' },
      { team: { id: '1' }, clock: { displayValue: "30'" }, type: { text: 'Yellow Card' }, scoringPlay: false, participants: [{ athlete: { displayName: 'B' } }], text: 'B is shown the yellow card.' },
    ],
    { '1': 'home' },
  );
  assert.equal(bookings[0].reason, 'pentru un fault dur');
  assert.equal(bookings[0].card, 'RED');
  assert.equal(bookings[1].card, 'YELLOW');
  assert.equal(bookings[1].reason, null);
});

test('eventsToFootballData ignores shootout events with empty clock', () => {
  const { goals } = eventsToFootballData(
    [{ clock: { displayValue: '' }, type: { text: 'Penalty - Scored' }, scoringPlay: true, participants: [{ athlete: { displayName: 'Taker' } }] }],
  );
  assert.deepEqual(goals, []);
});

test('eventsToFootballData stamps stoppage time as "90+2"', () => {
  const { goals } = eventsToFootballData(
    [{ team: { id: '1' }, clock: { displayValue: "90'+2'" }, type: { text: 'Goal' }, scoringPlay: true, participants: [{ athlete: { displayName: 'Montes' } }] }],
    { '1': 'home' },
  );
  assert.equal(goals[0].minute, '90+2');
});

import {
  digestReadiness,
  fetchDigestData,
  fetchNightMatches,
} from '../pipeline/espn.js';

test('digestReadiness: not ready while any match pending', () => {
  const r = digestReadiness([{ status: 'FINISHED' }, { status: 'IN_PLAY' }]);
  assert.equal(r.ready, false);
});

test('digestReadiness: ready when all terminal and at least one finished', () => {
  assert.equal(digestReadiness([{ status: 'FINISHED' }, { status: 'FINISHED' }]).ready, true);
  assert.equal(digestReadiness([{ status: 'FINISHED' }, { status: 'POSTPONED' }]).ready, true);
});

test('digestReadiness: only postponed/cancelled — not ready', () => {
  assert.equal(digestReadiness([{ status: 'POSTPONED' }, { status: 'CANCELLED' }]).ready, false);
});

test('digestReadiness: empty night is not ready', () => {
  assert.equal(digestReadiness([]).ready, false);
});

test('fetchDigestData: fixture run produces correct finished/tonight/standings shape', async () => {
  // Build a fetchImpl that serves the scoreboard fixture and summary fixture
  const scoreboard = JSON.parse(
    await readFile(new URL('./fixtures/scoreboard.json', import.meta.url), 'utf8'),
  );
  const summary = JSON.parse(
    await readFile(new URL('./fixtures/summary-760414.json', import.meta.url), 'utf8'),
  );
  const standings = JSON.parse(
    await readFile(new URL('./fixtures/espn-standings.json', import.meta.url), 'utf8'),
  );

  const fetchImpl = async (url) => {
    if (url.includes('/scoreboard?dates=20260611'))
      return jsonResponse({ events: scoreboard['20260611'].events });
    if (url.includes('/scoreboard?dates=20260612'))
      return jsonResponse({ events: scoreboard['20260612'].events });
    if (url.includes('/summary?event=760414'))
      return jsonResponse(summary);
    if (url.includes('/standings'))
      return jsonResponse(standings);
    return jsonResponse({ events: [] });
  };

  const result = await fetchDigestData({ digestDate: '2026-06-12', fetchImpl, delayMs: 0 });

  // 760414 and 760415 are both completed — both should be in finished
  assert.equal(result.finished.length, 2);
  const mex = result.finished.find((m) => m.id === 760414);
  assert.ok(mex, '760414 (Mexico v South Africa) in finished');
  assert.deepEqual(mex.score, [2, 1]);
  // Scorers from the summary (richer fixture: header, own goal, penalty)
  assert.ok(mex.scorers.length > 0, 'scorers populated from summary');
  assert.equal(mex.scorers[0].name, 'Giménez');
  // Tonight: 760416 (pre, in next window)
  assert.equal(result.tonight.length, 1);
  assert.equal(result.tonight[0].id, 760416);
  // Standings
  assert.equal(result.standings[0].name, 'A');
});

test('fetchNightMatches and fetchDigestData agree on which matches are finished', async () => {
  const scoreboard = JSON.parse(
    await readFile(new URL('./fixtures/scoreboard.json', import.meta.url), 'utf8'),
  );
  const summary = JSON.parse(
    await readFile(new URL('./fixtures/summary-760414.json', import.meta.url), 'utf8'),
  );
  const standings = JSON.parse(
    await readFile(new URL('./fixtures/espn-standings.json', import.meta.url), 'utf8'),
  );

  const fetchImpl = async (url) => {
    if (url.includes('/scoreboard?dates=20260611'))
      return jsonResponse({ events: scoreboard['20260611'].events });
    if (url.includes('/scoreboard?dates=20260612'))
      return jsonResponse({ events: scoreboard['20260612'].events });
    if (url.includes('/summary?event=760414'))
      return jsonResponse(summary);
    if (url.includes('/standings'))
      return jsonResponse(standings);
    // 760415 summary is absent — fetchSummary catches and returns null (bare match)
    return jsonResponse({ events: [] });
  };

  const nightMatches = await fetchNightMatches({ digestDate: '2026-06-12', fetchImpl });
  const digestData  = await fetchDigestData({ digestDate: '2026-06-12', fetchImpl, delayMs: 0 });

  const gateFinishedIds  = nightMatches.filter((m) => m.status === 'FINISHED').map((m) => m.id).sort();
  const buildFinishedIds = digestData.finished.map((m) => m.id).sort();
  assert.deepEqual(gateFinishedIds, buildFinishedIds, 'gate and build must agree on finished match set');
});

function jsonResponse(body) {
  return { ok: true, status: 200, async json() { return body; } };
}

test('teamStats projects six stats per side, null unless both sides resolve', () => {
  const summary = {
    boxscore: { teams: [
      { team: { id: '1' }, statistics: [{ name: 'possessionPct', displayValue: '51.4' }, { name: 'totalShots', displayValue: '12' }] },
      { team: { id: '2' }, statistics: [{ name: 'possessionPct', displayValue: '48.6' }, { name: 'saves', displayValue: '5' }] },
    ] },
  };
  const map = new Map([['1', 'home'], ['2', 'away']]);
  assert.deepEqual(teamStats(summary, map), {
    home: { possessionPct: '51.4', totalShots: '12' },
    away: { possessionPct: '48.6', saves: '5' },
  });
  assert.equal(teamStats(summary, new Map([['1', 'home']])), null);
  assert.equal(teamStats({}, map), null);
});

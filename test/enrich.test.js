import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  eventsToFootballData,
  matchEvent,
  enrichFinishedMatches,
  parseGoalManner,
  parseCardReason,
  teamStats,
} from '../pipeline/enrich.js';
import { parseMatch } from '../pipeline/fetch.js';

test('eventsToFootballData maps scoring plays to goals with scorer, minute, and team side', () => {
  const keyEvents = [
    { team: { id: '203' }, clock: { displayValue: "9'" }, type: { id: '70', text: 'Goal' }, scoringPlay: true, participants: [{ athlete: { displayName: 'Quiñones' } }, { athlete: { displayName: 'Lira' } }] },
    { team: { id: '467' }, clock: { displayValue: "67'" }, type: { id: '137', text: 'Goal - Header' }, scoringPlay: true, participants: [{ athlete: { displayName: 'Jiménez' } }] },
  ];
  const homeAwayById = { '203': 'home', '467': 'away' };
  const { goals } = eventsToFootballData(keyEvents, homeAwayById);
  assert.deepEqual(goals, [
    { minute: '9', scorer: { name: 'Quiñones' }, team: 'home', penalty: false, ownGoal: false, assist: 'Lira' },
    { minute: '67', scorer: { name: 'Jiménez' }, team: 'away', penalty: false, ownGoal: false, assist: null },
  ]);
});

test('parseGoalManner maps body part and placement to Romanian tokens', () => {
  assert.deepEqual(
    parseGoalManner('Ismael Saibari (Morocco) right footed shot from outside the box to the centre of the goal.'),
    { bodyPart: 'dreptul', placement: 'din afara careului' },
  );
  assert.deepEqual(
    parseGoalManner('Left footed shot from the centre of the box.'),
    { bodyPart: 'stângul', placement: 'din careu' },
  );
  assert.deepEqual(parseGoalManner('Header from the left side of the box.'), {
    bodyPart: 'cu capul',
    placement: 'din stânga careului',
  });
  assert.equal(parseGoalManner('Right footed shot from the right side of the box.').placement, 'din dreapta careului');
  assert.equal(parseGoalManner('Scored direct free kick.').placement, 'din lovitură liberă');
  assert.equal(parseGoalManner('Finished with the head.').bodyPart, 'cu capul');
});

test('parseGoalManner returns empty object for unknown or empty text', () => {
  assert.deepEqual(parseGoalManner('some unknown description'), {});
  assert.deepEqual(parseGoalManner(''), {});
});

test('parseCardReason maps known reasons and returns null otherwise', () => {
  assert.equal(parseCardReason('Casemiro (Brazil) is shown the yellow card for a bad foul.'), 'pentru un fault dur');
  assert.equal(parseCardReason('Player is shown the red card for a professional foul.'), 'pentru fault tactic');
  assert.equal(parseCardReason('Player is shown the yellow card for dissent.'), 'pentru proteste');
  assert.equal(parseCardReason('Abunada (Qatar) is shown the yellow card.'), null);
  assert.equal(parseCardReason('Player is shown the yellow card for time-wasting.'), null);
});

test('eventsToFootballData: penalty has penalty=true and no assist', () => {
  const { goals } = eventsToFootballData(
    [{ team: { id: '1' }, clock: { displayValue: "45'" }, type: { text: 'Penalty - Scored' }, scoringPlay: true, participants: [{ athlete: { displayName: 'Embolo' } }] }],
    { '1': 'home' },
  );
  assert.equal(goals[0].penalty, true);
  assert.equal(goals[0].ownGoal, false);
  assert.equal(goals[0].assist, null);
});

test('eventsToFootballData: own goal has ownGoal=true and participants[1] is NOT read as assist', () => {
  const { goals } = eventsToFootballData(
    [{ team: { id: '1' }, clock: { displayValue: "60'" }, type: { text: 'Own Goal' }, scoringPlay: true, participants: [{ athlete: { displayName: 'Muheim' } }, { athlete: { displayName: 'Ahmed' } }] }],
    { '1': 'home' },
  );
  assert.equal(goals[0].ownGoal, true);
  assert.equal(goals[0].penalty, false);
  assert.equal(goals[0].assist, null);
});

test('eventsToFootballData: plain Goal carries manner and assist from text/participants', () => {
  const { goals } = eventsToFootballData(
    [{
      team: { id: '1' }, clock: { displayValue: "21'" }, type: { text: 'Goal' }, scoringPlay: true,
      participants: [{ athlete: { displayName: 'Saibari' } }, { athlete: { displayName: 'Díaz' } }],
      text: 'Saibari right footed shot from outside the box. Assisted by Díaz.',
    }],
    { '1': 'away' },
  );
  assert.equal(goals[0].assist, 'Díaz');
  assert.equal(goals[0].bodyPart, 'dreptul');
  assert.equal(goals[0].placement, 'din afara careului');
});

test('eventsToFootballData: bookings carry a parsed reason or null', () => {
  const { bookings } = eventsToFootballData(
    [
      { team: { id: '1' }, clock: { displayValue: "17'" }, type: { text: 'Red Card' }, scoringPlay: false, participants: [{ athlete: { displayName: 'A' } }], text: 'A is shown the red card for a bad foul.' },
      { team: { id: '1' }, clock: { displayValue: "30'" }, type: { text: 'Yellow Card' }, scoringPlay: false, participants: [{ athlete: { displayName: 'B' } }], text: 'B is shown the yellow card.' },
    ],
    { '1': 'home' },
  );
  assert.equal(bookings[0].reason, 'pentru un fault dur');
  assert.equal(bookings[1].reason, null);
});

test('teamStats projects six stats per side, null unless both sides resolve', () => {
  const summary = {
    boxscore: {
      teams: [
        { team: { id: '1' }, statistics: [{ name: 'possessionPct', displayValue: '51.4' }, { name: 'totalShots', displayValue: '12' }] },
        { team: { id: '2' }, statistics: [{ name: 'possessionPct', displayValue: '48.6' }, { name: 'saves', displayValue: '5' }] },
      ],
    },
  };
  const map = new Map([['1', 'home'], ['2', 'away']]);
  assert.deepEqual(teamStats(summary, map), {
    home: { possessionPct: '51.4', totalShots: '12' },
    away: { possessionPct: '48.6', saves: '5' },
  });
  // One side unresolved → null (no half-populated block reaches narration).
  assert.equal(teamStats(summary, new Map([['1', 'home']])), null);
  assert.equal(teamStats({}, map), null);
});

test('eventsToFootballData keeps stoppage-time minute as "90+2"', () => {
  const keyEvents = [
    { team: { id: '203' }, clock: { displayValue: "90'+2'" }, type: { id: '70', text: 'Goal' }, scoringPlay: true, participants: [{ athlete: { displayName: 'Montes' } }] },
  ];
  const { goals } = eventsToFootballData(keyEvents, { '203': 'home' });
  assert.equal(goals[0].minute, '90+2');
});

test('eventsToFootballData stamps team null when a key event id is not in the map', () => {
  const keyEvents = [
    { team: { id: '999' }, clock: { displayValue: "9'" }, type: { id: '70', text: 'Goal' }, scoringPlay: true, participants: [{ athlete: { displayName: 'Ghost' } }] },
    { team: { id: '999' }, clock: { displayValue: "49'" }, type: { id: '93', text: 'Red Card' }, scoringPlay: false, participants: [{ athlete: { displayName: 'Ghost' } }] },
  ];
  const { goals, bookings } = eventsToFootballData(keyEvents, { '203': 'home' });
  assert.equal(goals[0].team, null);
  assert.equal(bookings[0].team, null);
});

test('eventsToFootballData maps red cards (incl. second yellow) and drops plain yellows', () => {
  const keyEvents = [
    { team: { id: '467' }, clock: { displayValue: "17'" }, type: { id: '94', text: 'Yellow Card' }, scoringPlay: false, participants: [{ athlete: { displayName: 'Mokoena' } }] },
    { team: { id: '467' }, clock: { displayValue: "49'" }, type: { id: '93', text: 'Red Card' }, scoringPlay: false, participants: [{ athlete: { displayName: 'Sithole' } }] },
    { team: { id: '203' }, clock: { displayValue: "84'" }, type: { id: '98', text: 'Red Card' }, scoringPlay: false, participants: [{ athlete: { displayName: 'Zwane' } }] },
  ];
  const { bookings } = eventsToFootballData(keyEvents, { '203': 'home', '467': 'away' });
  assert.deepEqual(bookings, [
    { minute: '17', card: 'YELLOW', player: { name: 'Mokoena' }, team: 'away', reason: null },
    { minute: '49', card: 'RED', player: { name: 'Sithole' }, team: 'away', reason: null },
    { minute: '84', card: 'RED', player: { name: 'Zwane' }, team: 'home', reason: null },
  ]);
});

test('eventsToFootballData ignores substitutions, delays, and kickoff/half markers', () => {
  const keyEvents = [
    { clock: { displayValue: '' }, type: { id: '80', text: 'Kickoff' }, scoringPlay: false, participants: [] },
    { clock: { displayValue: "56'" }, type: { id: '76', text: 'Substitution' }, scoringPlay: false, participants: [{ athlete: { displayName: 'X' } }, { athlete: { displayName: 'Y' } }] },
    { clock: { displayValue: "25'" }, type: { id: '129', text: 'Start Delay' }, scoringPlay: false, participants: [] },
  ];
  const { goals, bookings } = eventsToFootballData(keyEvents);
  assert.deepEqual(goals, []);
  assert.deepEqual(bookings, []);
});

test('eventsToFootballData ignores shootout penalties that carry no match minute', () => {
  const keyEvents = [
    { clock: { displayValue: '' }, type: { id: '70', text: 'Penalty - Scored' }, scoringPlay: true, participants: [{ athlete: { displayName: 'ShootoutTaker' } }] },
  ];
  const { goals } = eventsToFootballData(keyEvents);
  assert.deepEqual(goals, []);
});

test('output feeds parseMatch to produce team-attributed scorers and events', () => {
  const keyEvents = [
    { team: { id: '5' }, clock: { displayValue: "33'" }, type: { id: '70', text: 'Goal' }, scoringPlay: true, participants: [{ athlete: { displayName: 'Gnabry' } }] },
    { team: { id: '5' }, clock: { displayValue: "79'" }, type: { id: '93', text: 'Red Card' }, scoringPlay: false, participants: [{ athlete: { displayName: 'Rüdiger' } }] },
  ];
  const { goals, bookings } = eventsToFootballData(keyEvents, { '5': 'home' });
  const match = {
    id: 9,
    group: 'GROUP_E',
    utcDate: '2026-06-11T19:00:00Z',
    homeTeam: { name: 'Germania' },
    awayTeam: { name: 'Japonia' },
    score: { fullTime: { home: 1, away: 2 } },
    goals,
    bookings,
  };
  const parsed = parseMatch(match);
  assert.deepEqual(parsed.scorers, [{ name: 'Gnabry', minute: '33', team: 'home', penalty: false, ownGoal: false, assist: null, bodyPart: null, placement: null }]);
  assert.deepEqual(parsed.events, [{ name: 'Rüdiger', minute: '79', team: 'home', reason: null }]);
});

test('matchEvent pairs a football-data match to the ESPN event with the same kickoff', () => {
  const fdMatch = {
    utcDate: '2026-06-11T19:00:00Z',
    homeTeam: { name: 'Mexico' },
    awayTeam: { name: 'South Africa' },
  };
  const events = [
    { id: '760414', date: '2026-06-11T16:00Z', competitions: [{ competitors: [{ team: { displayName: 'South Korea' } }, { team: { displayName: 'Czechia' } }] }] },
    { id: '760415', date: '2026-06-11T19:00Z', competitions: [{ competitors: [{ team: { displayName: 'Mexico' } }, { team: { displayName: 'South Africa' } }] }] },
  ];
  assert.equal(matchEvent(fdMatch, events)?.id, '760415');
});

test('matchEvent disambiguates simultaneous kickoffs by team-name overlap', () => {
  const fdMatch = {
    utcDate: '2026-06-11T19:00:00Z',
    homeTeam: { name: 'United States' },
    awayTeam: { name: 'Wales' },
  };
  const events = [
    { id: '10', date: '2026-06-11T19:00Z', competitions: [{ competitors: [{ team: { displayName: 'England' } }, { team: { displayName: 'Iran' } }] }] },
    { id: '11', date: '2026-06-11T19:00Z', competitions: [{ competitors: [{ team: { displayName: 'United States' } }, { team: { displayName: 'Wales' } }] }] },
  ];
  assert.equal(matchEvent(fdMatch, events)?.id, '11');
});

test('matchEvent returns null when no kickoff matches', () => {
  const fdMatch = { utcDate: '2026-06-11T19:00:00Z', homeTeam: { name: 'Brazil' }, awayTeam: { name: 'Serbia' } };
  const events = [
    { id: '1', date: '2026-06-11T16:00Z', competitions: [{ competitors: [{ team: { displayName: 'Mexico' } }, { team: { displayName: 'South Africa' } }] }] },
  ];
  assert.equal(matchEvent(fdMatch, events), null);
});

test('enrichFinishedMatches attaches goals/bookings from the ESPN summary', async () => {
  const rawMatches = [
    {
      id: 537327,
      utcDate: '2026-06-11T19:00:00Z',
      homeTeam: { name: 'Mexico' },
      awayTeam: { name: 'South Africa' },
      score: { fullTime: { home: 2, away: 0 } },
    },
  ];
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('/scoreboard?')) {
      return jsonResponse({
        events: [
          { id: '760415', date: '2026-06-11T19:00Z', competitions: [{ competitors: [{ team: { displayName: 'Mexico' } }, { team: { displayName: 'South Africa' } }] }] },
        ],
      });
    }
    if (url.includes('/summary?event=760415')) {
      return jsonResponse({
        header: { competitions: [{ competitors: [
          { homeAway: 'home', team: { id: '203' } },
          { homeAway: 'away', team: { id: '467' } },
        ] }] },
        keyEvents: [
          { team: { id: '203' }, clock: { displayValue: "9'" }, type: { id: '70', text: 'Goal' }, scoringPlay: true, participants: [{ athlete: { displayName: 'Quiñones' } }] },
          { team: { id: '467' }, clock: { displayValue: "49'" }, type: { id: '93', text: 'Red Card' }, scoringPlay: false, participants: [{ athlete: { displayName: 'Sithole' } }] },
        ],
      });
    }
    throw new Error(`unexpected url ${url}`);
  };

  const enriched = await enrichFinishedMatches(rawMatches, { fetchImpl, delayMs: 0 });
  const parsed = parseMatch(enriched[0]);
  assert.deepEqual(parsed.scorers, [{ name: 'Quiñones', minute: '9', team: 'home', penalty: false, ownGoal: false, assist: null, bodyPart: null, placement: null }]);
  assert.deepEqual(parsed.events, [{ name: 'Sithole', minute: '49', team: 'away', reason: null }]);
  assert.ok(calls.some((u) => u.includes('dates=20260611')), 'queries the kickoff date in UTC');
});

test('enrichFinishedMatches leaves a match untouched when its summary fetch fails', async () => {
  const rawMatches = [
    {
      id: 1,
      utcDate: '2026-06-11T19:00:00Z',
      homeTeam: { name: 'Mexico' },
      awayTeam: { name: 'South Africa' },
      score: { fullTime: { home: 2, away: 0 } },
    },
  ];
  const fetchImpl = async (url) => {
    if (url.includes('/scoreboard?')) {
      return jsonResponse({
        events: [
          { id: '760415', date: '2026-06-11T19:00Z', competitions: [{ competitors: [{ team: { displayName: 'Mexico' } }, { team: { displayName: 'South Africa' } }] }] },
        ],
      });
    }
    return { ok: false, status: 500, async text() { return 'boom'; } };
  };
  const enriched = await enrichFinishedMatches(rawMatches, { fetchImpl, delayMs: 0 });
  const parsed = parseMatch(enriched[0]);
  assert.deepEqual(parsed.scorers, []);
  assert.deepEqual(parsed.events, []);
});

test('enrichFinishedMatches finds an after-midnight UTC match on the US-Eastern scoreboard date', async () => {
  // ESPN buckets the scoreboard by US/Eastern date, so a 02:00Z kickoff (late
  // evening ET the day before) is listed under the previous calendar day.
  const rawMatches = [
    {
      id: 1,
      utcDate: '2026-06-12T02:00:00Z',
      homeTeam: { name: 'South Korea' },
      awayTeam: { name: 'Czechia' },
      score: { fullTime: { home: 2, away: 1 } },
    },
  ];
  const queried = [];
  const fetchImpl = async (url) => {
    if (url.includes('/scoreboard?')) {
      queried.push(url.match(/dates=(\d+)/)[1]);
      if (url.includes('dates=20260611')) {
        return jsonResponse({
          events: [
            { id: '760414', date: '2026-06-12T02:00Z', competitions: [{ competitors: [{ team: { displayName: 'South Korea' } }, { team: { displayName: 'Czechia' } }] }] },
          ],
        });
      }
      return jsonResponse({ events: [] }); // the UTC date alone has nothing
    }
    if (url.includes('/summary?event=760414')) {
      return jsonResponse({
        header: { competitions: [{ competitors: [
          { homeAway: 'home', team: { id: '11' } },
          { homeAway: 'away', team: { id: '12' } },
        ] }] },
        keyEvents: [
          { team: { id: '11' }, clock: { displayValue: "30'" }, type: { id: '70', text: 'Goal' }, scoringPlay: true, participants: [{ athlete: { displayName: 'Son' } }] },
        ],
      });
    }
    throw new Error(`unexpected url ${url}`);
  };
  const enriched = await enrichFinishedMatches(rawMatches, { fetchImpl, delayMs: 0 });
  const parsed = parseMatch(enriched[0]);
  assert.deepEqual(parsed.scorers, [{ name: 'Son', minute: '30', team: 'home', penalty: false, ownGoal: false, assist: null, bodyPart: null, placement: null }]);
  assert.ok(queried.includes('20260611'), `expected the ET day to be queried, got ${JSON.stringify(queried)}`);
});

test('enrichFinishedMatches leaves team null when the summary has no header', async () => {
  const rawMatches = [
    { id: 1, utcDate: '2026-06-11T19:00:00Z', homeTeam: { name: 'Mexico' }, awayTeam: { name: 'South Africa' }, score: { fullTime: { home: 1, away: 0 } } },
  ];
  const fetchImpl = async (url) => {
    if (url.includes('/scoreboard?')) {
      return jsonResponse({
        events: [
          { id: '760415', date: '2026-06-11T19:00Z', competitions: [{ competitors: [{ team: { displayName: 'Mexico' } }, { team: { displayName: 'South Africa' } }] }] },
        ],
      });
    }
    if (url.includes('/summary?event=760415')) {
      return jsonResponse({
        keyEvents: [
          { team: { id: '203' }, clock: { displayValue: "9'" }, type: { id: '70', text: 'Goal' }, scoringPlay: true, participants: [{ athlete: { displayName: 'Quiñones' } }] },
        ],
      });
    }
    throw new Error(`unexpected url ${url}`);
  };
  const enriched = await enrichFinishedMatches(rawMatches, { fetchImpl, delayMs: 0 });
  const parsed = parseMatch(enriched[0]);
  assert.deepEqual(parsed.scorers, [{ name: 'Quiñones', minute: '9', team: null, penalty: false, ownGoal: false, assist: null, bodyPart: null, placement: null }]);
});

test('enrichFinishedMatches passes a match through when no ESPN event pairs', async () => {
  const rawMatches = [
    { id: 1, utcDate: '2026-06-11T19:00:00Z', homeTeam: { name: 'Brazil' }, awayTeam: { name: 'Serbia' }, score: { fullTime: { home: 1, away: 0 } } },
  ];
  const logs = [];
  const fetchImpl = async (url) => {
    if (url.includes('/scoreboard?')) return jsonResponse({ events: [] });
    throw new Error('should not fetch a summary');
  };
  const enriched = await enrichFinishedMatches(rawMatches, { fetchImpl, delayMs: 0, log: (m) => logs.push(m) });
  const parsed = parseMatch(enriched[0]);
  assert.deepEqual(parsed.scorers, []);
  assert.deepEqual(parsed.events, []);
  assert.ok(logs.some((m) => m.includes('no ESPN')), `expected a no-match log, got ${JSON.stringify(logs)}`);
});

test('enrichFinishedMatches attaches matchStats from the boxscore', async () => {
  const rawMatches = [
    { id: 1, utcDate: '2026-06-11T19:00:00Z', homeTeam: { name: 'Mexico' }, awayTeam: { name: 'South Africa' }, score: { fullTime: { home: 2, away: 0 } } },
  ];
  const fetchImpl = async (url) => {
    if (url.includes('/scoreboard?')) {
      return jsonResponse({ events: [{ id: '760415', date: '2026-06-11T19:00Z', competitions: [{ competitors: [{ team: { displayName: 'Mexico' } }, { team: { displayName: 'South Africa' } }] }] }] });
    }
    if (url.includes('/summary?event=760415')) {
      return jsonResponse({
        header: { competitions: [{ competitors: [{ homeAway: 'home', team: { id: '203' } }, { homeAway: 'away', team: { id: '467' } }] }] },
        keyEvents: [],
        boxscore: {
          teams: [
            { team: { id: '203' }, statistics: [{ name: 'possessionPct', displayValue: '55.0' }, { name: 'totalShots', displayValue: '14' }] },
            { team: { id: '467' }, statistics: [{ name: 'possessionPct', displayValue: '45.0' }, { name: 'saves', displayValue: '6' }] },
          ],
        },
      });
    }
    throw new Error(`unexpected url ${url}`);
  };
  const enriched = await enrichFinishedMatches(rawMatches, { fetchImpl, delayMs: 0 });
  assert.deepEqual(enriched[0].matchStats, {
    home: { possessionPct: '55.0', totalShots: '14' },
    away: { possessionPct: '45.0', saves: '6' },
  });
  assert.equal(parseMatch(enriched[0]).stats.home.possessionPct, '55.0');
});

function jsonResponse(body) {
  return { ok: true, status: 200, async json() { return body; } };
}

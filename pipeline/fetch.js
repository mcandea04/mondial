/**
 * football-data.org v4 client for the World Cup digest.
 * Free tier: ~10 req/min, so calls are serialized with a delay.
 */

import { romanianTeamName } from './teams.js';

const API_BASE = 'https://api.football-data.org/v4';
const REQUEST_DELAY_MS = 6500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The "night window" for a digest dated `digestDate` (YYYY-MM-DD, EEST morning):
 * matches with UTC kickoff in [previousDay 16:00 UTC, digestDate 06:00 UTC).
 * Covers 19:00–09:00 EEST without hardcoding the offset beyond the window
 * boundaries themselves, which are defined in UTC by the spec.
 */
export function nightWindow(digestDate) {
  const [year, month, day] = digestDate.split('-').map(Number);
  const end = new Date(Date.UTC(year, month - 1, day, 6, 0, 0));
  const start = new Date(end.getTime() - 14 * 60 * 60 * 1000);
  return { start, end };
}

/** Today's date string in Europe/Bucharest, regardless of host timezone. */
export function bucharestToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Kickoff time formatted as HH:mm in Europe/Bucharest. */
export function kickoffEEST(utcDate) {
  return new Intl.DateTimeFormat('ro-RO', {
    timeZone: 'Europe/Bucharest',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(utcDate));
}

export function isInNightWindow(utcDate, window) {
  const kickoff = new Date(utcDate);
  return kickoff >= window.start && kickoff < window.end;
}

async function apiGet(path, token) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'X-Auth-Token': token },
  });
  if (!response.ok) {
    throw new Error(`football-data.org ${path} returned ${response.status}`);
  }
  return response.json();
}

function dateString(date) {
  return date.toISOString().slice(0, 10);
}

/** The night window for the day after `window` (tonight's fixtures). */
function nextNightWindow(window) {
  return nightWindow(dateString(new Date(window.end.getTime() + 24 * 60 * 60 * 1000)));
}

/**
 * Splits a raw /matches response into last night's finished games and
 * tonight's upcoming fixtures, relative to `digestDate`. Shared by the live
 * fetch and the offline fixtures mode.
 */
export function selectDigestMatches(matchesResponse, digestDate) {
  const window = nightWindow(digestDate);
  const nextWindow = nextNightWindow(window);
  return {
    window,
    nextWindow,
    finished: matchesResponse.matches.filter(
      (m) => m.status === 'FINISHED' && isInNightWindow(m.utcDate, window),
    ),
    tonight: matchesResponse.matches.filter(
      (m) => m.status !== 'FINISHED' && isInNightWindow(m.utcDate, nextWindow),
    ),
  };
}

/**
 * Fetches everything the digest needs for `digestDate`:
 * - finished matches in the night window, with detail (goals/bookings) when available
 * - upcoming fixtures for tonight (the next night window)
 * - current group standings
 */
export async function fetchDigestData({ digestDate, token }) {
  const window = nightWindow(digestDate);
  const dateFrom = dateString(window.start);
  const dateTo = dateString(nextNightWindow(window).end);

  const matchesResponse = await apiGet(
    `/competitions/WC/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`,
    token,
  );

  const { finished, tonight } = selectDigestMatches(matchesResponse, digestDate);

  const detailed = [];
  for (const match of finished) {
    await sleep(REQUEST_DELAY_MS);
    try {
      detailed.push(await apiGet(`/matches/${match.id}`, token));
    } catch {
      // Detail endpoint unavailable (tier restriction): degrade to list data.
      detailed.push(match);
    }
  }

  await sleep(REQUEST_DELAY_MS);
  const standingsResponse = await apiGet('/competitions/WC/standings', token);

  return {
    finished: detailed.map(parseMatch),
    tonight: tonight.map(parseFixture),
    standings: parseStandings(standingsResponse),
  };
}

/** Normalizes a finished match; scorers/events are empty when detail is missing. */
export function parseMatch(match) {
  const goals = (match.goals ?? []).map(
    (g) => `${g.scorer?.name ?? '?'} ${g.minute}'`,
  );
  const events = (match.bookings ?? [])
    .filter((b) => b.card === 'RED' || b.card === 'YELLOW_RED')
    .map((b) => `roșu ${b.player?.name ?? '?'} ${b.minute}'`);
  if (match.score?.penalties) {
    events.push('decis la penalty-uri');
  }
  return {
    id: match.id,
    home: romanianTeamName(match.homeTeam.name),
    away: romanianTeamName(match.awayTeam.name),
    score: [match.score.fullTime.home, match.score.fullTime.away],
    scorers: goals,
    events,
    group: (match.group ?? '').replace('GROUP_', ''),
    utcDate: match.utcDate,
  };
}

export function parseFixture(match) {
  return {
    id: match.id,
    home: romanianTeamName(match.homeTeam.name),
    away: romanianTeamName(match.awayTeam.name),
    group: (match.group ?? '').replace('GROUP_', ''),
    utcDate: match.utcDate,
    kickoffEEST: kickoffEEST(match.utcDate),
  };
}

export function parseStandings(response) {
  return response.standings
    .filter((s) => s.type === 'TOTAL')
    .map((s) => ({
      name: s.group.replace('Group ', ''),
      table: s.table.map((row) => ({
        team: romanianTeamName(row.team.name),
        p: row.playedGames,
        w: row.won,
        d: row.draw,
        l: row.lost,
        gd: row.goalDifference,
        pts: row.points,
      })),
    }));
}

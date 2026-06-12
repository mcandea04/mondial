/**
 * football-data.org v4 client for the World Cup digest.
 * Free tier: ~10 req/min, so calls are serialized with a delay.
 */

import { romanianTeamName } from './teams.js';
import { enrichFinishedMatches } from './enrich.js';

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

/**
 * The digest date a poll at `now` belongs to. A poll inside the night window
 * [D-1 16:00 UTC, D 06:00 UTC) belongs to the morning-of-D digest, so anything
 * from 16:00 UTC onward counts toward the next day's digest.
 */
export function activeDigestDate(now = new Date()) {
  const base = new Date(now);
  if (base.getUTCHours() >= 16) base.setUTCDate(base.getUTCDate() + 1);
  return base.toISOString().slice(0, 10);
}

// Statuses where a match could still play or finish later tonight; any of these
// in the window means the night is not over yet.
const PENDING_STATUSES = new Set(['SCHEDULED', 'TIMED', 'IN_PLAY', 'PAUSED', 'SUSPENDED']);

/**
 * Decides whether a digest can be built for a night, given that night's matches.
 * The API only marks a match FINISHED once it is fully over — including extra
 * time and penalties — so no kickoff-time arithmetic is needed for knockouts.
 * POSTPONED/CANCELLED matches do not block (they won't play tonight).
 */
export function digestReadiness(matches) {
  if (matches.length === 0) {
    return { ready: false, reason: 'no matches scheduled for this night' };
  }
  const pending = matches.filter((m) => PENDING_STATUSES.has(m.status));
  if (pending.length > 0) {
    return { ready: false, reason: `${pending.length} of ${matches.length} matches not finished yet` };
  }
  const finished = matches.filter((m) => m.status === 'FINISHED');
  if (finished.length === 0) {
    return { ready: false, reason: 'no finished matches (all postponed/cancelled)' };
  }
  return { ready: true, reason: `all ${matches.length} matches terminal, ${finished.length} finished` };
}

/** Lightweight fetch of just this night's matches, for the readiness gate. */
export async function fetchNightMatches({ digestDate, token }) {
  const window = nightWindow(digestDate);
  const response = await apiGet(
    `/competitions/WC/matches?dateFrom=${dateString(window.start)}&dateTo=${dateString(window.end)}`,
    token,
  );
  return response.matches.filter((m) => isInNightWindow(m.utcDate, window));
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
 * - finished matches in the night window, enriched with scorers/cards from ESPN
 *   (football-data's free tier omits goals/bookings)
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

  const enriched = await enrichFinishedMatches(finished, {
    log: (message) => console.log(`enrich: ${message}`),
  });

  await sleep(REQUEST_DELAY_MS);
  const standingsResponse = await apiGet('/competitions/WC/standings', token);

  return {
    finished: enriched.map(parseMatch),
    tonight: tonight.map(parseFixture),
    standings: parseStandings(standingsResponse),
  };
}

/** Reads a 'home'/'away' team tag, leaving anything else (incl. missing) as null. */
function teamSide(value) {
  return value === 'home' || value === 'away' ? value : null;
}

/** Normalizes a finished match; scorers/events are empty when detail is missing. */
export function parseMatch(match) {
  const scorers = (match.goals ?? []).map((g) => ({
    name: g.scorer?.name ?? '?',
    minute: String(g.minute),
    team: teamSide(g.team),
  }));
  const events = (match.bookings ?? [])
    .filter((b) => b.card === 'RED' || b.card === 'YELLOW_RED')
    .map((b) => ({
      name: b.player?.name ?? '?',
      minute: String(b.minute),
      team: teamSide(b.team),
    }));
  return {
    id: match.id,
    home: romanianTeamName(match.homeTeam.name),
    away: romanianTeamName(match.awayTeam.name),
    score: [match.score.fullTime.home, match.score.fullTime.away],
    scorers,
    events,
    decidedOnPenalties: Boolean(match.score?.penalties),
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

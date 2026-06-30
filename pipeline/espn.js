/**
 * ESPN sole fact client for the World Cup digest: the EEST night-window math, the
 * scoreboard/summary/standings fetches, and the reshaping into the match shape the
 * rest of the pipeline consumes. Both fetchDigestData and fetchNightMatches derive
 * "finished" via isOver so the readiness gate and the build always agree on the
 * same match set.
 */

import { romanianTeamName, flagCode } from './teams.js';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';
const ESPN_STANDINGS_BASE = 'https://site.api.espn.com/apis/v2/sports/soccer/fifa.world';
const REQUEST_DELAY_MS = 200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Window math (migrated verbatim from fetch.js) ────────────────────────────

export function nightWindow(digestDate) {
  const [year, month, day] = digestDate.split('-').map(Number);
  const end = new Date(Date.UTC(year, month - 1, day, 6, 0, 0));
  const start = new Date(end.getTime() - 14 * 60 * 60 * 1000);
  return { start, end };
}

export function bucharestToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function kickoffEEST(utcDate) {
  return new Intl.DateTimeFormat('ro-RO', {
    timeZone: 'Europe/Bucharest',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(utcDate));
}

export function isInNightWindow(utcDate, window) {
  const kickoff = new Date(utcDate);
  return kickoff >= window.start && kickoff < window.end;
}

export function activeDigestDate(now = new Date()) {
  const base = new Date(now);
  if (base.getUTCHours() >= 16) base.setUTCDate(base.getUTCDate() + 1);
  return base.toISOString().slice(0, 10);
}

/** True once ESPN marks a scoreboard event finished. ESPN nests this flag at
 *  `status.type.completed` (top-level `completed` does not exist on a real event). */
const isCompleted = (event) => event.status?.type?.completed === true;

/** The single predicate for "is a match over?". Used by both gate and build. */
export const isOver = (event) => isCompleted(event);

// ── ESPN date bucketing ───────────────────────────────────────────────────────

/**
 * ESPN buckets scoreboard events by US/Eastern date (UTC-4 EDT / UTC-5 EST).
 * A match kicking off after midnight UTC but still the previous evening in ET
 * will appear on the previous ET calendar-day board. Return the UTC date and
 * the ET date, deduped, as YYYYMMDD strings.
 */
export function scoreboardDates(utcDate) {
  const kickoff = new Date(utcDate);
  const utcStr = kickoff.toISOString().slice(0, 10).replaceAll('-', '');
  const etStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(kickoff).replaceAll('-', '');
  return [...new Set([etStr, utcStr])];
}

// ── Shape helpers ─────────────────────────────────────────────────────────────

function competitorFor(event, side) {
  return (event.competitions?.[0]?.competitors ?? []).find((c) => c.homeAway === side);
}

function parseScore(competitor) {
  const n = Number(competitor?.score);
  return Number.isFinite(n) ? n : null;
}

function penaltyScore(penalties) {
  if (!penalties) return null;
  if (Array.isArray(penalties) && penalties.length === 2) {
    const [home, away] = penalties.map(Number);
    return Number.isFinite(home) && Number.isFinite(away) ? [home, away] : null;
  }
  const home = Number(penalties.home);
  const away = Number(penalties.away);
  return Number.isFinite(home) && Number.isFinite(away) ? [home, away] : null;
}

function stringParts(value) {
  if (value == null) return [];
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(stringParts);
  if (typeof value === 'object') return Object.values(value).flatMap(stringParts);
  return [];
}

const EXTRA_TIME_RE = /\b(after extra time|extra time|aet)\b/i;

function decidedAfter(event, penalties) {
  if (penalties) return 'penalties';
  const competition = event.competitions?.[0] ?? {};
  const statusText = [
    competition.status?.type?.description,
    competition.status?.type?.detail,
    event.status?.type?.description,
    event.status?.type?.detail,
  ].flatMap(stringParts);
  return statusText.some((text) => EXTRA_TIME_RE.test(text)) ? 'extraTime' : 'regular';
}

/** The fields shared by parseMatch and parseFixture: id, team names/codes, group, date. */
function teamIdentity(event, group, stage = null) {
  const homeTeam = competitorFor(event, 'home')?.team?.displayName ?? '';
  const awayTeam = competitorFor(event, 'away')?.team?.displayName ?? '';
  return {
    id: Number(event.id),
    home: romanianTeamName(homeTeam),
    away: romanianTeamName(awayTeam),
    homeCode: flagCode(homeTeam),
    awayCode: flagCode(awayTeam),
    group: group == null ? null : String(group),
    stage,
    utcDate: event.date,
  };
}

export function stageFromEvent(event) {
  const slug = event.season?.slug ?? '';
  const name = event.season?.name ?? '';
  const type = String(event.season?.type ?? '');
  const text = `${slug} ${name} ${type}`.toLowerCase();
  if (text.includes('round-of-32') || text.includes('round of 32') || text.includes('13801')) return 'round-of-32';
  if (text.includes('round-of-16') || text.includes('round of 16')) return 'round-of-16';
  if (text.includes('quarter')) return 'quarterfinal';
  if (text.includes('semi')) return 'semifinal';
  if (text.includes('final')) return 'final';
  return null;
}

export function nextStage(stage) {
  return {
    'round-of-32': 'round-of-16',
    'round-of-16': 'quarterfinal',
    quarterfinal: 'semifinal',
    semifinal: 'final',
    final: 'champion',
  }[stage] ?? null;
}

function knockoutResult(event, penalties = null) {
  const home = competitorFor(event, 'home');
  const away = competitorFor(event, 'away');
  const winner = [home, away].find((c) => c?.winner === true);
  const loser = [home, away].find((c) => c && c !== winner);
  if (winner && loser) {
    return {
      winner: romanianTeamName(winner.team?.displayName ?? ''),
      loser: romanianTeamName(loser.team?.displayName ?? ''),
      winnerSide: winner.homeAway,
      loserSide: loser.homeAway,
    };
  }

  const homeScore = parseScore(home);
  const awayScore = parseScore(away);
  if (homeScore == null || awayScore == null) return {};
  if (homeScore === awayScore) {
    if (penalties?.[0] > penalties?.[1]) {
      return {
        winner: romanianTeamName(home?.team?.displayName ?? ''),
        loser: romanianTeamName(away?.team?.displayName ?? ''),
        winnerSide: 'home',
        loserSide: 'away',
      };
    }
    if (penalties?.[1] > penalties?.[0]) {
      return {
        winner: romanianTeamName(away?.team?.displayName ?? ''),
        loser: romanianTeamName(home?.team?.displayName ?? ''),
        winnerSide: 'away',
        loserSide: 'home',
      };
    }
    return {};
  }
  return homeScore > awayScore
    ? {
      winner: romanianTeamName(home?.team?.displayName ?? ''),
      loser: romanianTeamName(away?.team?.displayName ?? ''),
      winnerSide: 'home',
      loserSide: 'away',
    }
    : {
      winner: romanianTeamName(away?.team?.displayName ?? ''),
      loser: romanianTeamName(home?.team?.displayName ?? ''),
      winnerSide: 'away',
      loserSide: 'home',
    };
}

function synthesizeStatus(event) {
  if (isCompleted(event)) return 'FINISHED';
  const state = event.status?.type?.state ?? '';
  if (state === 'post') return 'POSTPONED';
  if (state === 'in')   return 'IN_PLAY';
  return 'TIMED';
}

/**
 * Maps a completed ESPN event to the FD-compatible match shape.
 * `group` comes from the caller (standings team→group map).
 * id is normalised to Number so facts-hash byId sort stays type-stable.
 */
export function parseMatch(event, group = '', stage = stageFromEvent(event)) {
  const home = competitorFor(event, 'home');
  const away = competitorFor(event, 'away');
  const penalties = penaltyScore(event.penalties);
  const scorers = (event.goals ?? []).map((g) => ({
    name: g.scorer?.name ?? '?',
    minute: String(g.minute),
    team: g.team ?? null,
    penalty: g.penalty ?? false,
    ownGoal: g.ownGoal ?? false,
    assist: g.assist ?? null,
    bodyPart: g.bodyPart ?? null,
    placement: g.placement ?? null,
  }));
  const events = (event.bookings ?? [])
    .filter((b) => b.card === 'RED' || b.card === 'YELLOW_RED')
    .map((b) => ({
      name: b.player?.name ?? '?',
      minute: String(b.minute),
      team: b.team ?? null,
      reason: b.reason ?? null,
    }));
  return {
    ...teamIdentity(event, group, stage),
    score: [parseScore(home), parseScore(away)],
    scorers,
    events,
    stats: event.matchStats ?? null,
    decidedAfter: decidedAfter(event, penalties),
    penalties,
    decidedOnPenalties: Boolean(penalties),
    ...(stage ? { winnerAdvancesTo: nextStage(stage) } : {}),
    ...(stage ? knockoutResult(event, penalties) : {}),
  };
}

export function parseFixture(event, group = '', stage = stageFromEvent(event)) {
  return {
    ...teamIdentity(event, group, stage),
    kickoffEEST: kickoffEEST(event.date),
    ...(stage ? { winnerAdvancesTo: nextStage(stage) } : {}),
  };
}

// ── Enrichment helpers (migrated from enrich.js) ─────────────────────────────

const BODY_PART_MAP = [
  [/\bright[- ]footed\b/i, 'dreptul'],
  [/\bleft[- ]footed\b/i, 'stângul'],
  [/\bheader\b/i, 'cu capul'],
  [/\bwith the head\b/i, 'cu capul'],
];

const PLACEMENT_MAP = [
  [/\bfrom outside the box\b/i, 'din afara careului'],
  [/\bfrom the centre of the box\b/i, 'din careu'],
  [/\bfrom the left side of the box\b/i, 'din stânga careului'],
  [/\bfrom the right side of the box\b/i, 'din dreapta careului'],
  [/\bdirect free kick\b/i, 'din lovitură liberă'],
  [/\bfrom a free kick\b/i, 'din lovitură liberă'],
];

const CARD_REASON_MAP = new Map([
  ['for a bad foul',           'pentru un fault dur'],
  ['for a professional foul',  'pentru fault tactic'],
  ['for dissent',              'pentru proteste'],
  ['for unsporting behaviour', 'pentru atitudine nesportivă'],
  ['for a rough tackle',       'pentru o intrare dură'],
]);

const TEAM_STAT_NAMES = ['possessionPct', 'totalShots', 'shotsOnTarget', 'wonCorners', 'saves', 'foulsCommitted'];

export function parseGoalManner(text) {
  const result = {};
  for (const [pattern, token] of BODY_PART_MAP) {
    if (pattern.test(text)) { result.bodyPart = token; break; }
  }
  for (const [pattern, token] of PLACEMENT_MAP) {
    if (pattern.test(text)) { result.placement = token; break; }
  }
  return result;
}

export function parseCardReason(text) {
  const match = text.match(/the (?:yellow|red) card\s+(for [\w\s]+?)\s*\.?\s*$/i);
  if (!match) return null;
  return CARD_REASON_MAP.get(match[1].trim().toLowerCase()) ?? null;
}

function sideById(map, id) {
  if (id == null) return null;
  const side = map instanceof Map ? map.get(id) : map?.[id];
  return side ?? null;
}

function minute(clock) {
  return (clock?.displayValue ?? '').replaceAll("'", '');
}

export function eventsToFootballData(keyEvents = [], homeAwayById = {}) {
  const goals = [];
  const bookings = [];
  for (const event of keyEvents) {
    const min = minute(event.clock);
    const name = event.participants?.[0]?.athlete?.displayName;
    const type = event.type?.text ?? '';
    const team = sideById(homeAwayById, event.team?.id);
    if (event.scoringPlay && min) {
      const assist = type === 'Goal' ? (event.participants?.[1]?.athlete?.displayName ?? null) : null;
      goals.push({
        minute: min,
        scorer: { name },
        team,
        penalty: type === 'Penalty - Scored',
        ownGoal: type === 'Own Goal',
        assist,
        ...parseGoalManner(event.text ?? ''),
      });
    } else if (type.includes('Red Card')) {
      bookings.push({ minute: min, card: 'RED', player: { name }, team, reason: parseCardReason(event.text ?? '') });
    } else if (type.includes('Yellow Card')) {
      bookings.push({ minute: min, card: 'YELLOW', player: { name }, team, reason: parseCardReason(event.text ?? '') });
    }
  }
  return { goals, bookings };
}

export function teamStats(summary, homeAwayById) {
  const teams = summary?.boxscore?.teams;
  if (!Array.isArray(teams) || teams.length === 0) return null;
  const result = {};
  for (const entry of teams) {
    const side = sideById(homeAwayById, entry.team?.id);
    if (side !== 'home' && side !== 'away') continue;
    const stats = {};
    for (const stat of entry.statistics ?? []) {
      if (TEAM_STAT_NAMES.includes(stat.name) && stat.displayValue != null) {
        stats[stat.name] = stat.displayValue;
      }
    }
    result[side] = stats;
  }
  return result.home && result.away ? result : null;
}

function homeAwayMap(summary) {
  const competitors = summary.header?.competitions?.[0]?.competitors ?? [];
  const byId = new Map();
  for (const c of competitors) {
    if (c.team?.id != null && c.homeAway) byId.set(c.team.id, c.homeAway);
  }
  return byId;
}

/**
 * Maps the ESPN `/standings` response (children[] with group name + entries[])
 * to the same shape parseStandings returned from football-data.
 */
export function parseStandings(response) {
  return (response.children ?? []).map((child) => {
    const name = (child.name ?? '').replace('Group ', '');
    const table = (child.standings?.entries ?? []).map((entry) => {
      const stat = (n) => entry.stats?.find((s) => s.name === n)?.value ?? 0;
      return {
        team: romanianTeamName(entry.team?.displayName ?? ''),
        code: flagCode(entry.team?.displayName ?? ''),
        p:   stat('gamesPlayed'),
        w:   stat('wins'),
        d:   stat('ties'),
        l:   stat('losses'),
        gf:  entry.stats?.find((s) => s.name === 'pointsFor')?.value ?? null,
        gd:  stat('pointDifferential'),
        pts: stat('points'),
      };
    });
    table.sort((a, b) => b.pts - a.pts || b.gd - a.gd);
    return { name, table };
  });
}

// ── Readiness ─────────────────────────────────────────────────────────────────

const PENDING_STATUSES = new Set(['SCHEDULED', 'TIMED', 'IN_PLAY', 'PAUSED', 'SUSPENDED']);

export function digestReadiness(matches) {
  if (matches.length === 0)
    return { ready: false, reason: 'no matches scheduled for this night' };
  const pending = matches.filter((m) => PENDING_STATUSES.has(m.status));
  if (pending.length > 0)
    return { ready: false, reason: `${pending.length} of ${matches.length} matches not finished yet` };
  const finished = matches.filter((m) => m.status === 'FINISHED');
  if (finished.length === 0)
    return { ready: false, reason: 'no finished matches (all postponed/cancelled)' };
  return { ready: true, reason: `all ${matches.length} matches terminal, ${finished.length} finished` };
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

/**
 * Single-shot ESPN GET. No retry. Design decision:
 *
 * - `fetchNightMatches` (readiness gate) has no retry because a transient ESPN
 *   error just causes the gate to exit non-zero; the 15-min poller retries the
 *   whole run anyway within the night window.
 * - `fetchDigestData` scoreboard/standings calls have no retry for the same
 *   reason; the poller is the retry mechanism. A per-summary failure is caught
 *   locally by `fetchSummary` — that match ships bare and recovers on the next
 *   poll via `mergeEnrichment` (existing outage-restore logic).
 * - Adding a retry loop (e.g., 3× with backoff) is YAGNI here: ESPN's site API
 *   is a CDN-served read endpoint, not an eventually-consistent write backend.
 *   Unlike football-data's free tier, it does not flap between states. A 503
 *   that survives three retries will not recover in the same run; the poller
 *   handles it. Retry policy can be added if transient ESPN outages are
 *   observed in practice.
 *
 * Therefore: one shot per request; per-summary failures are swallowed locally
 * (the match ships bare); scoreboard and standings failures propagate and
 * fail the run (prior digest stays live, poller retries).
 */
async function espnGet(path, fetchImpl, base = ESPN_BASE) {
  const response = await fetchImpl(`${base}${path}`);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ESPN ${path} returned ${response.status}: ${body.slice(0, 200)}`);
  }
  return response.json();
}

// ── Group lookup (team name → group letter) ───────────────────────────────────

function buildGroupMap(standingsResponse) {
  const map = new Map();
  for (const child of standingsResponse.children ?? []) {
    const groupName = (child.name ?? '').replace('Group ', '');
    for (const entry of child.standings?.entries ?? []) {
      const name = entry.team?.displayName;
      if (name) map.set(name, groupName);
    }
  }
  return map;
}

function groupFor(event, groupMap) {
  const home = competitorFor(event, 'home')?.team?.displayName;
  const away = competitorFor(event, 'away')?.team?.displayName;
  const g = (home && groupMap.get(home)) ?? (away && groupMap.get(away)) ?? '';
  if (!g && home) console.warn(`espn: no group found for ${home}–${away}`);
  return g;
}

// ── Per-event summary fetch ───────────────────────────────────────────────────

/**
 * Per-summary failure contract:
 *
 * - A transient /summary failure returns null; the match ships with
 *   scorers=[], events=[], stats=null (bare facts). `digestReadiness` gates
 *   only on `completed===true` status — a bare match does NOT block the night.
 *   If all polls fail, the digest publishes the match with empty enrichment.
 * - On the next poll, if /summary recovers, `mergeEnrichment` restores prior
 *   scorers/events (the existing outage-restore logic, unchanged). `mergeStats`
 *   fills the null stats slot with fresh stats on the recovery poll (write-once
 *   fill). After first non-null fill, stats are frozen.
 * - If /summary fails for ALL polls of the night (a hard ESPN outage for this
 *   event): the digest publishes bare facts, stats=null, the freeze never
 *   triggers, and that match stays enrichment-free permanently for that day.
 *   This is acceptable — it is the same behavior as today when the ESPN
 *   enrich.js call fails, and is far better than a missed digest.
 * - There is NO summaryOk flag or readiness dependency on enrichment success.
 *   The gate is status-only; enrichment quality is best-effort.
 */
async function fetchSummary(eventId, { fetchImpl, log }) {
  try {
    return await espnGet(`/summary?event=${eventId}`, fetchImpl);
  } catch (error) {
    log(`summary fetch failed for event ${eventId}: ${error.message}`);
    return null;
  }
}

function penaltiesFromSummary(summary) {
  const competitors = summary?.header?.competitions?.[0]?.competitors ?? [];
  const home = competitors.find((c) => c.homeAway === 'home');
  const away = competitors.find((c) => c.homeAway === 'away');
  const homeShootout = Number(home?.shootoutScore);
  const awayShootout = Number(away?.shootoutScore);
  if (Number.isFinite(homeShootout) && Number.isFinite(awayShootout)) {
    return { home: homeShootout, away: awayShootout };
  }

  const keyEvents = summary?.keyEvents ?? [];
  const haMap = homeAwayMap(summary);
  const shootoutGoals = keyEvents.filter(
    (e) => e.scoringPlay && !minute(e.clock) && e.type?.text === 'Penalty - Scored',
  );
  if (shootoutGoals.length === 0) return null;
  const count = { home: 0, away: 0 };
  for (const g of shootoutGoals) {
    const side = sideById(haMap, g.team?.id);
    if (side === 'home') count.home++;
    if (side === 'away') count.away++;
  }
  return count;
}

// ── Scoreboard dedup by event id ──────────────────────────────────────────────

async function nightEvents(digestDate, fetchImpl) {
  const window = nightWindow(digestDate);
  // Collect all ET-date boards that could contain night-window events.
  // scoreboardDates is per-match; for the whole night we need both boards
  // that the window spans (UTC start date and UTC end date).
  const startDate = window.start.toISOString().slice(0, 10).replaceAll('-', '');
  const endDate = window.end.toISOString().slice(0, 10).replaceAll('-', '');
  const dates = [...new Set([startDate, endDate])];

  const byId = new Map();
  for (const date of dates) {
    const data = await espnGet(`/scoreboard?dates=${date}`, fetchImpl);
    for (const event of data.events ?? []) byId.set(event.id, event);
    await sleep(REQUEST_DELAY_MS);
  }
  return [...byId.values()].filter((e) => isInNightWindow(e.date, window));
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Lightweight fetch for the readiness gate. */
export async function fetchNightMatches({
  digestDate,
  fetchImpl = fetch,
}) {
  const events = await nightEvents(digestDate, fetchImpl);
  return events.map((e) => ({
    id: Number(e.id),
    status: synthesizeStatus(e),
    utcDate: e.date,
  }));
}

/**
 * Full digest data fetch. Returns { finished (enriched), tonight, standings }.
 * Accepts optional fetchImpl (for tests) and delayMs (to silence test delays).
 */
export async function fetchDigestData({
  digestDate,
  fetchImpl = fetch,
  delayMs = REQUEST_DELAY_MS,
  log = (msg) => console.log(`espn: ${msg}`),
}) {
  const window = nightWindow(digestDate);
  const nextDigestDate = new Date(window.end.getTime() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const nextWindow = nightWindow(nextDigestDate);

  const standingsRaw = await espnGet('/standings', fetchImpl, ESPN_STANDINGS_BASE);
  const groupMap = buildGroupMap(standingsRaw);
  await sleep(delayMs);

  const lastNightEvents = await nightEvents(digestDate, fetchImpl);
  const tonightEventsRaw = await nightEvents(nextDigestDate, fetchImpl);

  const finishedEvents  = lastNightEvents.filter(isOver);
  const tonightEvents   = tonightEventsRaw.filter(
    (e) => !isOver(e) && isInNightWindow(e.date, nextWindow),
  );

  // Enrich each finished event with its summary
  const finished = [];
  for (const event of finishedEvents) {
    const summary = await fetchSummary(event.id, { fetchImpl, log });
    await sleep(delayMs);
    const haMap = summary ? homeAwayMap(summary) : new Map();
    const { goals, bookings } = summary
      ? eventsToFootballData(summary.keyEvents ?? [], haMap)
      : { goals: [], bookings: [] };
    const stats = summary ? teamStats(summary, haMap) : null;
    const penalties = summary ? penaltiesFromSummary(summary) : null;
    const group = groupFor(event, groupMap);
    const enrichedEvent = { ...event, goals, bookings, matchStats: stats, penalties };
    finished.push(parseMatch(enrichedEvent, group));
  }

  const tonight = tonightEvents.map((e) => {
    const group = groupFor(e, groupMap);
    return parseFixture(e, group);
  });

  return {
    finished,
    tonight,
    standings: parseStandings(standingsRaw),
  };
}

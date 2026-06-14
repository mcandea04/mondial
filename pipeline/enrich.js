/**
 * Scorer and card enrichment via ESPN's public soccer API.
 *
 * football-data.org's free tier returns WC matches without `goals`/`bookings`,
 * so finished matches carry no scorer or card detail. ESPN's site API serves
 * the WC2026 competition for free with no key: the scoreboard lists a date's
 * events, and each event's summary carries a `keyEvents` timeline (goals, cards,
 * minutes, scorer names). This module reshapes that into football-data's
 * `goals[]` / `bookings[]` shape, so `parseMatch` stays the single normalizer
 * and offline fixtures keep working unchanged.
 *
 * Enrichment is best-effort: any failure (no event match, an HTTP error, a bad
 * payload) leaves the match exactly as it came from football-data, which
 * `parseMatch` already degrades to empty `scorers`/`events`. A missing scorer
 * never blocks a night from publishing.
 */

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';
const REQUEST_DELAY_MS = 200; // Unofficial endpoint — space the per-match calls out.

// ── Closed-vocabulary mapping tables (English ESPN phrase → Romanian token) ──
// These are the single source of truth for goal manner and card reasons. A new
// ESPN phrase is a code change (add a row), never dynamic discovery; an
// unrecognized phrase yields no token, never an error.

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
  ['for a bad foul', 'pentru un fault dur'],
  ['for a professional foul', 'pentru fault tactic'],
  ['for dissent', 'pentru proteste'],
  ['for unsporting behaviour', 'pentru atitudine nesportivă'],
  ['for a rough tackle', 'pentru o intrare dură'],
]);

// The six match stats we surface, by ESPN's own `statistics[].name`.
const TEAM_STAT_NAMES = ['possessionPct', 'totalShots', 'shotsOnTarget', 'wonCorners', 'saves', 'foulsCommitted'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves an ESPN team id to 'home'/'away' against a Map or plain-object map. */
function sideById(homeAwayById, id) {
  if (id == null) return null;
  const side = homeAwayById instanceof Map ? homeAwayById.get(id) : homeAwayById?.[id];
  return side ?? null;
}

/**
 * Parses an ESPN goal `text` into fixed Romanian tokens for body part and
 * placement. Returns only the keys it recognizes (absent = unknown, never a
 * thrown error); `parseMatch` later normalizes an absent key to null so the
 * model sees a uniform shape.
 */
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

/**
 * Extracts a booking reason from an ESPN card `text` and maps it to a Romanian
 * token. The `for …` clause after "the yellow|red card" is captured directly, so
 * a bare "… yellow card." (no reason) and an off-table reason both return null —
 * no English ever reaches the model.
 */
export function parseCardReason(text) {
  const match = text.match(/the (?:yellow|red) card\s+(for [\w\s]+?)\s*\.?\s*$/i);
  if (!match) return null;
  return CARD_REASON_MAP.get(match[1].trim().toLowerCase()) ?? null;
}

/**
 * Projects the six chosen stats per team from the ESPN summary boxscore, keyed
 * 'home'/'away' via the same id map used for events. Values are kept as the raw
 * `displayValue` strings (no Number() — sidesteps the "–"→NaN trap; the model
 * never does arithmetic on them). Returns null unless BOTH sides resolve, so a
 * half-populated stats block never reaches narration.
 */
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

/**
 * ESPN's scoreboard dates by US/Eastern day, so a kickoff after 00:00 UTC can
 * land on the previous calendar day's board. ET is UTC-4/-5, so the match is on
 * either the UTC date or the day before — query both as YYYYMMDD.
 */
function scoreboardDates(utcDate) {
  const kickoff = new Date(utcDate);
  const prev = new Date(kickoff.getTime() - 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');
  return [...new Set([fmt(prev), fmt(kickoff)])];
}

function normalizeName(name) {
  return (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 2);
}

function competitorNames(event) {
  return (event.competitions?.[0]?.competitors ?? []).map((c) => c.team?.displayName);
}

/**
 * Pairs a football-data match to an ESPN event. Kickoff time must agree; when
 * several games kick off at the same minute (the final group round), team-name
 * overlap breaks the tie. Score is not compared — extra-time/shootout totals
 * can differ between sources, and kickoff + names already identify a match.
 */
export function matchEvent(fdMatch, events) {
  const kickoff = new Date(fdMatch.utcDate).getTime();
  const sameKickoff = events.filter((e) => new Date(e.date).getTime() === kickoff);

  if (sameKickoff.length <= 1) return sameKickoff[0] ?? null;

  const fdTokens = new Set([
    ...normalizeName(fdMatch.homeTeam.name),
    ...normalizeName(fdMatch.awayTeam.name),
  ]);
  const overlap = (e) =>
    competitorNames(e).flatMap(normalizeName).filter((t) => fdTokens.has(t)).length;

  return sameKickoff
    .map((e) => ({ e, score: overlap(e) }))
    .sort((a, b) => b.score - a.score)
    .find(({ score }) => score > 0)?.e ?? null;
}

/** ESPN's clock "90'+2'" → "90+2", "9'" → "9". Empty for shootout entries. */
function minute(clock) {
  return (clock?.displayValue ?? '').replaceAll("'", '');
}

/** 'home'/'away' for a key event's team, from the header id map; null if unknown. */
function sideOf(event, homeAwayById) {
  return sideById(homeAwayById, event.team?.id);
}

/**
 * Reshapes ESPN keyEvents into football-data `goals[]` / `bookings[]`, stamping
 * each with the 'home'/'away' side resolved from `homeAwayById` (a Map or object
 * from ESPN team id to side). Unknown ids fall back to team: null.
 */
export function eventsToFootballData(keyEvents, homeAwayById = {}) {
  const goals = [];
  const bookings = [];
  for (const event of keyEvents) {
    const min = minute(event.clock);
    const name = event.participants?.[0]?.athlete?.displayName;
    const type = event.type?.text ?? '';
    const team = sideOf(event, homeAwayById);
    // Goals carry a match minute; shootout penalties have an empty clock — skip them.
    if (event.scoringPlay && min) {
      // Only a plain "Goal" has an assist in participants[1]. "Penalty - Scored"
      // has a single participant (the taker); "Own Goal" has participants[1] as
      // the OPPONENT, not an assister — verified live 2026-06-13. An unrecognized
      // type stays open-play (penalty:false, ownGoal:false): the safe default.
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

/** Builds an ESPN-team-id → 'home'/'away' map from a summary's header competitors. */
function homeAwayMap(summary) {
  const competitors = summary.header?.competitions?.[0]?.competitors ?? [];
  const byId = new Map();
  for (const competitor of competitors) {
    if (competitor.team?.id != null && competitor.homeAway) {
      byId.set(competitor.team.id, competitor.homeAway);
    }
  }
  return byId;
}

async function espnGet(path, fetchImpl) {
  const response = await fetchImpl(`${ESPN_BASE}${path}`);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ESPN ${path} returned ${response.status}: ${body.slice(0, 200)}`);
  }
  return response.json();
}

/** A scoreboard date's WC events, cached per date across the batch. */
async function eventsForDate(date, cache, fetchImpl) {
  if (!cache.has(date)) {
    const data = await espnGet(`/scoreboard?dates=${date}`, fetchImpl);
    cache.set(date, data.events ?? []);
  }
  return cache.get(date);
}

/** Events on either ESPN board a match could appear on, deduped by id. */
async function candidateEvents(utcDate, cache, fetchImpl) {
  const byId = new Map();
  for (const date of scoreboardDates(utcDate)) {
    for (const event of await eventsForDate(date, cache, fetchImpl)) {
      byId.set(event.id, event);
    }
  }
  return [...byId.values()];
}

/**
 * Enriches finished football-data matches with scorers and cards. Returns a new
 * array; matches that can't be enriched are passed through untouched.
 *
 * @param fetchImpl - injected for tests; defaults to global fetch.
 */
export async function enrichFinishedMatches(
  rawMatches,
  { fetchImpl = fetch, delayMs = REQUEST_DELAY_MS, log = () => {} } = {},
) {
  const eventsByDate = new Map();
  const enriched = [];

  for (const match of rawMatches) {
    const label = `${match.homeTeam?.name}–${match.awayTeam?.name}`;
    try {
      const events = await candidateEvents(match.utcDate, eventsByDate, fetchImpl);
      const event = matchEvent(match, events);
      if (!event) {
        log(`no ESPN event for ${label}`);
        enriched.push(match);
        continue;
      }
      await sleep(delayMs);
      const summary = await espnGet(`/summary?event=${event.id}`, fetchImpl);
      const haMap = homeAwayMap(summary);
      const { goals, bookings } = eventsToFootballData(summary.keyEvents ?? [], haMap);
      enriched.push({ ...match, goals, bookings, matchStats: teamStats(summary, haMap) });
    } catch (error) {
      log(`enrichment failed for ${label}: ${error.message}`);
      enriched.push(match);
    }
  }
  return enriched;
}

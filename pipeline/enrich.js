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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

/** Reshapes ESPN keyEvents into football-data `goals[]` / `bookings[]`. */
export function eventsToFootballData(keyEvents) {
  const goals = [];
  const bookings = [];
  for (const event of keyEvents) {
    const min = minute(event.clock);
    const name = event.participants?.[0]?.athlete?.displayName;
    const type = event.type?.text ?? '';
    // Goals carry a match minute; shootout penalties have an empty clock — skip them.
    if (event.scoringPlay && min) {
      goals.push({ minute: min, scorer: { name } });
    } else if (type.includes('Red Card')) {
      bookings.push({ minute: min, card: 'RED', player: { name } });
    } else if (type.includes('Yellow Card')) {
      bookings.push({ minute: min, card: 'YELLOW', player: { name } });
    }
  }
  return { goals, bookings };
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
      const { goals, bookings } = eventsToFootballData(summary.keyEvents ?? []);
      enriched.push({ ...match, goals, bookings });
    } catch (error) {
      log(`enrichment failed for ${label}: ${error.message}`);
      enriched.push(match);
    }
  }
  return enriched;
}

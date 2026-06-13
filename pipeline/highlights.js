/**
 * Official FIFA match highlights, linked to a finished game as a fact.
 *
 * FIFA publishes highlight reels on its public watch pages (no auth, no key)
 * and exposes them through a section-news JSON feed. We read the feed, keep only
 * canonical match reels, and key each to a finished match by kickoff minute and
 * country code. Per-goal clips, Alt Cast reimaginings and Play Zone items fail
 * the canonical suffix and are dropped.
 *
 * A highlight URL is a fact, not voice: it is fetched here and merged in run.js,
 * keyed by match id, never produced by the narration model. A feed outage must
 * never fail the digest, so fetchRecaps soft-fails to an empty map.
 */

import { fifaTricodeToFlag } from './teams.js';

const SECTION_ID = '1klF18lgpe12FFtd1IoTSs';
const LISTING_URL = `https://cxm-api.fifa.com/fifaplusweb/api/sections/news/${SECTION_ID}?locale=en&limit=50`;

export { SECTION_ID, LISTING_URL };

const CANONICAL_SUFFIX = ' | FIFA World Cup 2026™ | Highlights';
export { CANONICAL_SUFFIX };

const WATCH_BASE = 'https://www.fifa.com/en/watch/';

const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 1000;

/** Floors an epoch-ms value to the whole minute (FIFA carries minute precision). */
function floorToMinute(ms) {
  return Math.floor(ms / 60_000) * 60_000;
}

/**
 * Parses "… on MM/DD/YYYY HH:mm UTC" into epoch ms via Date.UTC. Returns null
 * when the suffix is absent or unparseable. Never uses Date.parse, whose
 * MM/DD/YYYY handling is engine- and locale-dependent.
 */
function parseKickoffMs(matchTagTitle) {
  const m = matchTagTitle?.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})\s+UTC$/);
  if (!m) return null;
  const [, mm, dd, yyyy, hh, min] = m;
  return Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min));
}

/**
 * Parses the FIFA listing JSON into canonical highlight entries.
 * Each entry is { url, kickoffMs, codes } where codes is an unordered array of
 * our flag codes (length 1 or 2; null tricodes are dropped). Non-canonical items
 * are dropped silently; canonical-but-malformed items are skipped individually.
 */
export function parseHighlightFeed(json) {
  const items = Array.isArray(json?.items) ? json.items : [];
  const entries = [];
  for (const item of items) {
    const title = item?.title;
    if (typeof title !== 'string' || !title.endsWith(CANONICAL_SUFFIX)) continue;

    const entryId = item?.entryId;
    if (typeof entryId !== 'string' || entryId.length === 0) continue;

    const tags = Array.isArray(item?.semanticTags) ? item.semanticTags : [];
    const matchTag = tags.find((t) => t?.sourceCategory === 'Match');
    const kickoffMs = parseKickoffMs(matchTag?.title);
    if (kickoffMs === null) continue;

    const codes = tags
      .filter((t) => t?.sourceCategory === 'Country')
      .map((t) => fifaTricodeToFlag(t?.id))
      .filter((code) => code !== null);

    entries.push({ url: `${WATCH_BASE}${entryId}`, kickoffMs, codes });
  }
  return entries;
}

/** True when the entry's codes confirm the match (at least one side matches). */
function codesConfirmMatch(entry, match) {
  return entry.codes.some((code) => code === match.homeCode || code === match.awayCode);
}

/**
 * Maps finished-match ids to highlight URLs. Keys each entry by kickoff minute;
 * when more than one finished match shares the minute (simultaneous group games)
 * the country-code guard disambiguates. An entry resolving to zero or, after the
 * guard, still more than one match is dropped (never guessed). First entry in
 * array order wins per match.
 */
export function recapsFor(matches, entries) {
  const recaps = new Map();
  for (const entry of entries) {
    const sameMinute = matches.filter(
      (m) => floorToMinute(Date.parse(m.utcDate)) === entry.kickoffMs,
    );
    const resolved =
      sameMinute.length === 1 ? sameMinute : sameMinute.filter((m) => codesConfirmMatch(entry, m));
    if (resolved.length !== 1) continue;
    const match = resolved[0];
    if (!recaps.has(match.id)) recaps.set(match.id, entry.url);
  }
  return recaps;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isTransientStatus(status) {
  return status === 429 || status >= 500;
}

/**
 * Fetches the FIFA highlights feed once (with a short bounded retry on transient
 * failures) and maps finished-match ids to watch URLs. Never throws: a permanent
 * failure, a 404, or a body with no usable items shape soft-fails to an empty
 * map so a FIFA outage cannot break the digest.
 */
export async function fetchRecaps({ matches, fetchImpl = fetch }) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(LISTING_URL);
    } catch (error) {
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_BASE_MS * attempt);
        continue;
      }
      console.warn(`FIFA highlights feed unavailable; skipping highlights: ${error.message}`);
      return new Map();
    }

    if (!response.ok) {
      if (isTransientStatus(response.status) && attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_BASE_MS * attempt);
        continue;
      }
      console.warn(`FIFA highlights feed returned ${response.status}; skipping highlights.`);
      return new Map();
    }

    let json;
    try {
      json = JSON.parse(await response.text());
    } catch (error) {
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_BASE_MS * attempt);
        continue;
      }
      console.warn(`FIFA highlights feed returned unparseable JSON; skipping highlights.`);
      return new Map();
    }

    return recapsFor(matches, parseHighlightFeed(json));
  }
  return new Map();
}

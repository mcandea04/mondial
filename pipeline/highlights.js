/**
 * Match recaps from the El Gráfico YouTube channel, linked to a game as a fact.
 *
 * The channel publishes full-match recaps with a fixed Spanish title shape:
 *   "{HOME} {h} - {a} {AWAY} | COPA MUNDIAL DE LA FIFA 2026"
 * We read its public RSS feed (no API key), keep only those recap titles, and
 * key each to a finished match by team names AND score. Per-goal Shorts, news
 * clips and the ceremony do not match the pattern and are dropped.
 *
 * A recap URL is a fact, not voice: it is fetched here and merged in run.js,
 * never produced by the narration model. A feed outage must never fail the
 * digest, so fetchRecaps swallows errors and returns an empty map.
 */

import { spanishTeamName } from './teams.js';

const CHANNEL_ID = 'UCOM489bmNdFfcPvSxf7p_xQ';
export const RECAP_FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;

const RECAP_SUFFIX = 'COPA MUNDIAL DE LA FIFA 2026';

/** Uppercase and strip diacritics so "México" and "MEXICO" compare equal. */
function normalize(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

/** Parses the channel Atom feed into recap candidates, keeping only watch?v= videos. */
export function parseRecapFeed(xml) {
  const entries = [];
  for (const block of xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? []) {
    const videoId = block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    const title = block.match(/<title>([^<]+)<\/title>/)?.[1];
    const url = block.match(/<link rel="alternate" href="([^"]+)"/)?.[1];
    if (!videoId || !title || !url || !url.includes('watch?v=')) continue;
    entries.push({ videoId, title, url });
  }
  return entries;
}

/** The recap URL for a finished match, or null when no feed entry matches it. */
export function matchRecap(match, entries) {
  const home = normalize(spanishTeamName(match.home));
  const away = normalize(spanishTeamName(match.away));
  const expected = `${home} ${match.score[0]} - ${match.score[1]} ${away}`;
  for (const entry of entries) {
    const title = normalize(entry.title);
    if (title.includes(expected) && title.includes(RECAP_SUFFIX)) return entry.url;
  }
  return null;
}

/** Maps the ids of matches that have a recap entry to their recap URLs. */
export function recapsFor(matches, entries) {
  const recaps = new Map();
  for (const match of matches) {
    const url = matchRecap(match, entries);
    if (url) recaps.set(match.id, url);
  }
  return recaps;
}

/**
 * Fetches the recap feed once and maps finished-match ids to recap URLs.
 * Never throws: a non-200, network error, or parse failure yields an empty map
 * so a YouTube outage cannot break the digest.
 */
export async function fetchRecaps({ matches, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(RECAP_FEED_URL);
    if (!response.ok) {
      console.warn(`Recap feed returned ${response.status}; skipping highlights.`);
      return new Map();
    }
    return recapsFor(matches, parseRecapFeed(await response.text()));
  } catch (error) {
    console.warn(`Recap feed unavailable; skipping highlights: ${error.message}`);
    return new Map();
  }
}

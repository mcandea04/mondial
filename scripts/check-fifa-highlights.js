/**
 * Manual live check (not a node --test case): fetches the real FIFA highlights
 * feed and (a) prints the keyed matchId -> url map for a small hardcoded
 * recent-night match list and (b) audits every Country tricode the live feed
 * emits against the FIFA_TRICODE_TO_FLAG map, printing any the map does not
 * cover. Self-contained: needs no FOOTBALL_DATA_TOKEN. Exits non-zero only on a
 * thrown error, never on an empty map or an unmapped-tricode finding.
 *
 * The tricode audit exists because the 48-row map is hand-authored from memory
 * (only MEX/RSA were ever observed live); a wrong-but-plausible key maps a real
 * nation to null and silently drops its highlight on a simultaneous-kickoff
 * matchday, with no error and no test signal. Run this against a live
 * multi-match feed before trusting the table.
 *
 * Run: node scripts/check-fifa-highlights.js
 *
 * Update RECENT_NIGHT before running for a fresh night: the kickoff utcDate must
 * be minute-accurate against football-data, and the codes are our flag codes.
 */

import { fetchRecaps, LISTING_URL, CANONICAL_SUFFIX } from '../pipeline/highlights.js';
import { fifaTricodeToFlag } from '../pipeline/teams.js';

const RECENT_NIGHT = [
  { id: 1, homeCode: 'mx', awayCode: 'za', utcDate: '2026-06-11T19:00:00Z' },
  { id: 2, homeCode: 'kr', awayCode: 'cz', utcDate: '2026-06-12T02:00:00Z' },
  { id: 3, homeCode: 'ca', awayCode: 'ba', utcDate: '2026-06-12T19:00:00Z' },
  { id: 4, homeCode: 'us', awayCode: 'py', utcDate: '2026-06-13T01:00:00Z' },
];

/**
 * Collects every Country tag id (FIFA tricode) on canonical items in the live
 * feed and returns those the map does not cover (fifaTricodeToFlag -> null).
 * Only canonical items are audited so Alt Cast / Play Zone noise tricodes do not
 * raise false drift. Returns [] if the feed can't be read (this audit is
 * best-effort and never throws on a feed problem).
 */
async function unmappedTricodes() {
  let response;
  try {
    response = await fetch(LISTING_URL);
    if (!response.ok) return [];
  } catch {
    return [];
  }
  let json;
  try {
    json = JSON.parse(await response.text());
  } catch {
    return [];
  }
  const items = Array.isArray(json?.items) ? json.items : [];
  const observed = new Set();
  for (const item of items) {
    if (typeof item?.title !== 'string' || !item.title.endsWith(CANONICAL_SUFFIX)) continue;
    const tags = Array.isArray(item?.semanticTags) ? item.semanticTags : [];
    for (const tag of tags) {
      if (tag?.sourceCategory === 'Country' && typeof tag.id === 'string') observed.add(tag.id);
    }
  }
  return [...observed].filter((tricode) => fifaTricodeToFlag(tricode) === null).sort();
}

async function main() {
  const recaps = await fetchRecaps({ matches: RECENT_NIGHT });
  if (recaps.size === 0) {
    console.log('No highlights keyed (feed may not have published these reels yet).');
  } else {
    for (const [id, url] of recaps) {
      console.log(`${id} -> ${url}`);
    }
  }

  const unmapped = await unmappedTricodes();
  if (unmapped.length === 0) {
    console.log('Tricode audit: every Country tricode in the live feed is mapped.');
  } else {
    console.log(`Tricode audit: ${unmapped.length} unmapped tricode(s) in the live feed:`);
    for (const tricode of unmapped) console.log(`  ${tricode} -> (no flag code; FIX FIFA_TRICODE_TO_FLAG)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

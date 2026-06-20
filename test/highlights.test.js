import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHighlightFeed, recapsFor, fetchRecaps, CANONICAL_SUFFIX } from '../pipeline/highlights.js';

const FIXTURES = path.join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures');
const feed = JSON.parse(await readFile(path.join(FIXTURES, 'highlights.json'), 'utf8'));

const mexicoMatch = { id: 537327, homeCode: 'mx', awayCode: 'za', utcDate: '2026-06-11T19:00:00Z' };
const canadaMatch = { id: 537328, homeCode: 'ca', awayCode: 'qa', utcDate: '2026-06-12T02:00:00Z' };

/** Runs fn with console.warn silenced; returns the captured warn messages. */
async function withSilencedWarn(fn) {
  const original = console.warn;
  const warns = [];
  console.warn = (msg) => warns.push(msg);
  try {
    await fn();
  } finally {
    console.warn = original;
  }
  return warns;
}

// 1. Canonical filter keeps highlights, drops Alt Cast and Play Zone.
test('parseHighlightFeed keeps canonical reels and drops Alt Cast and Play Zone', () => {
  const entries = parseHighlightFeed(feed);
  assert.equal(entries.length, 2);
  assert.ok(entries.every((e) => e.url.startsWith('https://www.fifa.com/en/watch/')));
  assert.ok(!entries.some((e) => e.url.includes('altCast')));
  assert.ok(!entries.some((e) => e.url.includes('playZone')));
});

// 2. Extracts entryId -> watch URL, kickoff ms (UTC, host-TZ independent), codes.
test('parseHighlightFeed extracts watch URL, UTC kickoff ms and flag codes', () => {
  const entry = parseHighlightFeed(feed).find((e) => e.url.endsWith('mexSudHighlight'));
  assert.equal(entry.url, 'https://www.fifa.com/en/watch/mexSudHighlight');
  assert.equal(entry.kickoffMs, Date.UTC(2026, 5, 11, 19, 0));
  assert.deepEqual([...entry.codes].sort(), ['mx', 'za']);
});

// 3. recapsFor keys a video to the right match by kickoff minute.
test('recapsFor keys a video to the right match by kickoff minute', () => {
  const recaps = recapsFor([mexicoMatch, canadaMatch], parseHighlightFeed(feed));
  assert.equal(recaps.get(537327), 'https://www.fifa.com/en/watch/mexSudHighlight');
  assert.equal(recaps.get(537328), 'https://www.fifa.com/en/watch/canQatHighlight');
});

// 4. Seconds tolerance: a utcDate with non-zero seconds still keys to the minute.
test('recapsFor tolerates non-zero seconds in football-data utcDate', () => {
  const withSeconds = { ...mexicoMatch, utcDate: '2026-06-11T19:00:43Z' };
  const recaps = recapsFor([withSeconds], parseHighlightFeed(feed));
  assert.equal(recaps.get(537327), 'https://www.fifa.com/en/watch/mexSudHighlight');
});

// 5. Simultaneous kickoff disambiguated by flag code.
test('recapsFor disambiguates simultaneous kickoffs by flag code', () => {
  const entries = [
    { url: 'https://www.fifa.com/en/watch/aaa', kickoffMs: Date.UTC(2026, 5, 11, 19, 0), codes: ['mx', 'za'] },
    { url: 'https://www.fifa.com/en/watch/bbb', kickoffMs: Date.UTC(2026, 5, 11, 19, 0), codes: ['fr', 'de'] },
  ];
  const matchA = { id: 1, homeCode: 'mx', awayCode: 'za', utcDate: '2026-06-11T19:00:00Z' };
  const matchB = { id: 2, homeCode: 'fr', awayCode: 'de', utcDate: '2026-06-11T19:00:00Z' };
  const recaps = recapsFor([matchA, matchB], entries);
  assert.equal(recaps.get(1), 'https://www.fifa.com/en/watch/aaa');
  assert.equal(recaps.get(2), 'https://www.fifa.com/en/watch/bbb');
});

// 5b. FIFA metadata kickoff offset: entry timestamp can lag ESPN by up to 60 min.
test('recapsFor matches when FIFA timestamp is 60 minutes off from ESPN', () => {
  const entry = [
    { url: 'https://www.fifa.com/en/watch/mexSudHighlight', kickoffMs: Date.UTC(2026, 5, 11, 20, 0), codes: ['mx', 'za'] },
  ];
  const recaps = recapsFor([mexicoMatch], entry);
  assert.equal(recaps.get(537327), 'https://www.fifa.com/en/watch/mexSudHighlight');
});

// 6. A video matching no finished match is dropped.
test('recapsFor drops a video whose kickoff matches no finished match', () => {
  const orphan = [{ url: 'https://www.fifa.com/en/watch/zzz', kickoffMs: Date.UTC(2026, 5, 1, 12, 0), codes: ['br', 'hr'] }];
  const recaps = recapsFor([mexicoMatch, canadaMatch], orphan);
  assert.equal(recaps.size, 0);
});

// 7. Still-ambiguous after the guard (incl. both-codes-null knockout placeholder) is dropped.
test('recapsFor drops a video that stays ambiguous after the code guard', () => {
  const entries = [
    { url: 'https://www.fifa.com/en/watch/ccc', kickoffMs: Date.UTC(2026, 5, 11, 19, 0), codes: ['mx', 'za'] },
  ];
  // Two placeholder matches at the same minute, both codes null: nothing can confirm.
  const placeholderA = { id: 10, homeCode: null, awayCode: null, utcDate: '2026-06-11T19:00:00Z' };
  const placeholderB = { id: 11, homeCode: null, awayCode: null, utcDate: '2026-06-11T19:00:00Z' };
  const recaps = recapsFor([placeholderA, placeholderB], entries);
  assert.equal(recaps.size, 0);
});

// 8. At-most-one-per-match: first canonical item in feed order wins.
test('recapsFor keeps the first feed-order entry when two resolve to the same match', () => {
  const entries = [
    { url: 'https://www.fifa.com/en/watch/first', kickoffMs: Date.UTC(2026, 5, 11, 19, 0), codes: ['mx', 'za'] },
    { url: 'https://www.fifa.com/en/watch/reupload', kickoffMs: Date.UTC(2026, 5, 11, 19, 0), codes: ['mx', 'za'] },
  ];
  const recaps = recapsFor([mexicoMatch], entries);
  assert.equal(recaps.get(537327), 'https://www.fifa.com/en/watch/first');
});

// 9. fetchRecaps retries transient failures then succeeds; soft-fails on permanent 404.
test('fetchRecaps retries a 5xx then succeeds via injected fetch', async () => {
  let calls = 0;
  const body = JSON.stringify(feed);
  const flaky = async () => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 503, text: async () => 'down' };
    return { ok: true, status: 200, text: async () => body };
  };
  const recaps = await fetchRecaps({ matches: [mexicoMatch, canadaMatch], fetchImpl: flaky });
  assert.equal(calls, 2);
  assert.equal(recaps.get(537327), 'https://www.fifa.com/en/watch/mexSudHighlight');
});

test('fetchRecaps retries a thrown network error then succeeds', async () => {
  let calls = 0;
  const body = JSON.stringify(feed);
  const flaky = async () => {
    calls += 1;
    if (calls === 1) throw new Error('ECONNRESET');
    return { ok: true, status: 200, text: async () => body };
  };
  const recaps = await fetchRecaps({ matches: [canadaMatch], fetchImpl: flaky });
  assert.equal(calls, 2);
  assert.equal(recaps.get(537328), 'https://www.fifa.com/en/watch/canQatHighlight');
});

test('fetchRecaps soft-fails to an empty map on a permanent 404', async () => {
  const notFound = async () => ({ ok: false, status: 404, text: async () => 'nope' });
  let recaps;
  const warns = await withSilencedWarn(async () => {
    recaps = await fetchRecaps({ matches: [mexicoMatch], fetchImpl: notFound });
  });
  assert.equal(recaps.size, 0);
  assert.equal(warns.length, 1);
});

// 10. Per-item validation: empty entryId is skipped, no .../watch/undefined.
test('parseHighlightFeed skips a canonical item with an empty entryId', () => {
  const malformed = {
    items: [
      {
        entryId: '',
        title: `Bad Item${CANONICAL_SUFFIX}`,
        semanticTags: [{ sourceCategory: 'Match', title: 'X v Y on 06/11/2026 19:00 UTC', id: '1' }],
      },
      {
        entryId: 'goodOne',
        title: `Good Item${CANONICAL_SUFFIX}`,
        semanticTags: [
          { sourceCategory: 'Match', title: 'X v Y on 06/11/2026 20:00 UTC', id: '2' },
          { sourceCategory: 'Country', title: 'Mexico', id: 'MEX' },
        ],
      },
    ],
  };
  const entries = parseHighlightFeed(malformed);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].url, 'https://www.fifa.com/en/watch/goodOne');
  assert.ok(!entries.some((e) => e.url.endsWith('/undefined')));
});

// 11. Tricode -> flag-code conversion through the feed (incl. sub-national; unknown -> dropped).
test('parseHighlightFeed converts FIFA tricodes incl. sub-national, dropping unknown ones', () => {
  const item = {
    items: [
      {
        entryId: 'homeNations',
        title: `England v Scotland${CANONICAL_SUFFIX}`,
        semanticTags: [
          { sourceCategory: 'Match', title: 'England v Scotland on 06/15/2026 18:00 UTC', id: '3' },
          { sourceCategory: 'Country', title: 'England', id: 'ENG' },
          { sourceCategory: 'Country', title: 'Scotland', id: 'SCO' },
          { sourceCategory: 'Country', title: 'Nowhere', id: 'ZZZ' },
        ],
      },
    ],
  };
  const entry = parseHighlightFeed(item)[0];
  assert.deepEqual([...entry.codes].sort(), ['gb-eng', 'gb-sct']);
});

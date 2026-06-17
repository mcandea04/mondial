import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTeaser, buildTeaserEn } from '../pipeline/teaser.js';

const URL = 'https://mcandea04.github.io/mondial/';

test('plural matches: recap clause appended with comma before azi-noapte', () => {
  const teaser = buildTeaser({ headline: 'Test', matchCount: 4, siteUrl: URL });
  assert.equal(teaser, `⚽ Test · 4 meciuri azi-noapte, cu rezumate video\n${URL}`);
});

test('singular match: recap clause appended', () => {
  const teaser = buildTeaser({ headline: 'Test', matchCount: 1, siteUrl: URL });
  assert.equal(teaser, `⚽ Test · 1 meci azi-noapte, cu rezumate video\n${URL}`);
});

test('zero matches: pauza clause with no recap mention', () => {
  const teaser = buildTeaser({ headline: 'Pauză', matchCount: 0, siteUrl: URL });
  assert.equal(teaser, `⚽ Pauză · pauză azi-noapte\n${URL}`);
});

test('buildTeaser does not accept recapCount (ignored if passed)', () => {
  // Passing recapCount must not change the output — it is no longer part of the API.
  const withCount = buildTeaser({ headline: 'Test', matchCount: 2, recapCount: 99, siteUrl: URL });
  const withoutCount = buildTeaser({ headline: 'Test', matchCount: 2, siteUrl: URL });
  assert.equal(withCount, withoutCount);
  assert.equal(withCount, `⚽ Test · 2 meciuri azi-noapte, cu rezumate video\n${URL}`);
});

test('buildTeaserEn pluralizes matches in English', () => {
  assert.equal(
    buildTeaserEn({ headline: 'Big night', matchCount: 3, siteUrl: 'https://x/' }),
    '⚽ Big night · 3 matches overnight, with video highlights\nhttps://x/',
  );
});

test('buildTeaserEn handles one match and none', () => {
  assert.match(buildTeaserEn({ headline: 'H', matchCount: 1, siteUrl: 'u' }), /1 match overnight/);
  assert.match(buildTeaserEn({ headline: 'H', matchCount: 0, siteUrl: 'u' }), /no matches overnight/);
});

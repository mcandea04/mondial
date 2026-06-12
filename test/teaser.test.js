import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTeaser } from '../pipeline/teaser.js';

const URL = 'https://mcandea04.github.io/mondial/';

test('teaser without recaps keeps the plain match-count line', () => {
  const teaser = buildTeaser({ headline: 'Test', matchCount: 2, recapCount: 0, siteUrl: URL });
  assert.equal(teaser, `⚽ Test · 2 meciuri azi-noapte\n${URL}`);
});

test('teaser appends a recap clause when recaps exist', () => {
  const teaser = buildTeaser({ headline: 'Test', matchCount: 2, recapCount: 2, siteUrl: URL });
  assert.equal(teaser, `⚽ Test · 2 meciuri + 2 rezumate video azi-noapte\n${URL}`);
});

test('recap clause is singular for a single recap', () => {
  const teaser = buildTeaser({ headline: 'Test', matchCount: 3, recapCount: 1, siteUrl: URL });
  assert.equal(teaser, `⚽ Test · 3 meciuri + 1 rezumat video azi-noapte\n${URL}`);
});

test('missing recapCount behaves like zero (backward compatible)', () => {
  const teaser = buildTeaser({ headline: 'Test', matchCount: 2, siteUrl: URL });
  assert.equal(teaser, `⚽ Test · 2 meciuri azi-noapte\n${URL}`);
});

test('no matches: recap clause is never shown', () => {
  const teaser = buildTeaser({ headline: 'Pauză', matchCount: 0, recapCount: 0, siteUrl: URL });
  assert.equal(teaser, `⚽ Pauză · pauză azi-noapte\n${URL}`);
});

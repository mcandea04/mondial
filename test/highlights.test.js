import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRecapFeed, matchRecap, fetchRecaps } from '../pipeline/highlights.js';

const FIXTURES = path.join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures');
const recapXml = await readFile(path.join(FIXTURES, 'recaps.xml'), 'utf8');

// Match facts carry Romanian names (the output of parseMatch).
const mexicoMatch = { id: 1, home: 'Mexic', away: 'Africa de Sud', score: [2, 1] };
const canadaMatch = { id: 2, home: 'Canada', away: 'Qatar', score: [4, 0] };

test('parseRecapFeed keeps only watch?v= videos, dropping shorts', () => {
  const entries = parseRecapFeed(recapXml);
  assert.ok(entries.length >= 2);
  assert.ok(entries.every((e) => e.url.includes('watch?v=')));
  assert.ok(entries.every((e) => !e.url.includes('/shorts/')));
});

test('parseRecapFeed extracts id, title and url', () => {
  const entry = parseRecapFeed(recapXml).find((e) => e.videoId === 'mexSud1111');
  assert.equal(entry.url, 'https://www.youtube.com/watch?v=mexSud1111');
  assert.match(entry.title, /MÉXICO 2 - 1 SUDÁFRICA/);
});

test('matchRecap links a full-match recap to the right game', () => {
  const entries = parseRecapFeed(recapXml);
  assert.equal(matchRecap(mexicoMatch, entries), 'https://www.youtube.com/watch?v=mexSud1111');
});

test('matchRecap handles diacritics and Spanish exonyms (Canadá/Catar)', () => {
  const entries = parseRecapFeed(recapXml);
  assert.equal(matchRecap(canadaMatch, entries), 'https://www.youtube.com/watch?v=canQat0000');
});

test('matchRecap rejects a single-goal Short title (no recap suffix, dropped as a short)', () => {
  // The goal Short "... | MÉXICO 2 SUDÁFRICA 1" lacks the "n - n" score and the recap suffix.
  const entries = [
    {
      videoId: 'x',
      title: 'EL PRIMER GOL DEL MUNDIAL ... | MÉXICO 2 SUDÁFRICA 1',
      url: 'https://www.youtube.com/watch?v=x',
    },
  ];
  assert.equal(matchRecap(mexicoMatch, entries), null);
});

test('matchRecap does not attach when the score disagrees', () => {
  const entries = parseRecapFeed(recapXml);
  const wrongScore = { ...mexicoMatch, score: [3, 0] };
  assert.equal(matchRecap(wrongScore, entries), null);
});

test('matchRecap returns null when no entry matches (late-night gap)', () => {
  const entries = parseRecapFeed(recapXml);
  const unplayed = { id: 9, home: 'Brazilia', away: 'Croația', score: [1, 1] };
  assert.equal(matchRecap(unplayed, entries), null);
});

test('fetchRecaps maps match ids to recap urls via the injected fetch', async () => {
  const fakeFetch = async () => ({ ok: true, status: 200, text: async () => recapXml });
  const recaps = await fetchRecaps({ matches: [mexicoMatch, canadaMatch], fetchImpl: fakeFetch });
  assert.equal(recaps.get(1), 'https://www.youtube.com/watch?v=mexSud1111');
  assert.equal(recaps.get(2), 'https://www.youtube.com/watch?v=canQat0000');
});

test('fetchRecaps never throws on a feed error, returns an empty map', async () => {
  const failing = async () => ({ ok: false, status: 503, text: async () => 'down' });
  const recaps = await fetchRecaps({ matches: [mexicoMatch], fetchImpl: failing });
  assert.equal(recaps.size, 0);
});

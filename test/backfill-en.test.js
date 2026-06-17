import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backfillDay, needsBackfill, reconstructFacts } from '../pipeline/backfill-en.js';

const legacyDigest = {
  date: '2026-06-12',
  narrator: 'gemini',
  headline: 'RO titlu',
  summary: 'RO sumar.',
  matches: [{ id: 1, home: 'A', away: 'B', score: [1, 0], scorers: [], events: [], stats: null, pill: 'RO pastilă', drama: 2 }],
  groups: [{ name: 'A', table: [] }],
  tonight: [{ id: 2, home: 'C', away: 'D', kickoffEEST: '21:00', alarm: 'merită văzut', why: 'RO de ce' }],
  teaser: '⚽ RO titlu · 1 meci azi-noapte, cu rezumate video\nhttps://x/',
};

const enNarration = {
  headline: 'EN headline',
  summary: 'EN summary.',
  matches: [{ id: 1, pill: 'EN pill', drama: 2 }],
  // The English model's own alarm is ignored — alarm.en is derived from the
  // canonical Romanian verdict — so this value is deliberately the "wrong" one.
  tonight: [{ id: 2, alarm: 'catch it later', why: 'EN why' }],
};

test('needsBackfill: true for a flat-string day, false once headline.en exists', () => {
  assert.equal(needsBackfill(legacyDigest), true);
  assert.equal(needsBackfill(backfillDay(legacyDigest, enNarration)), false);
});

test('backfillDay merges EN and preserves RO verbatim', () => {
  const out = backfillDay(legacyDigest, enNarration);
  assert.deepEqual(out.headline, { ro: 'RO titlu', en: 'EN headline' });
  assert.deepEqual(out.matches[0].pill, { ro: 'RO pastilă', en: 'EN pill' });
  // alarm.en is the canonical RO verdict mapped to English, NOT the EN model's call
  assert.deepEqual(out.tonight[0].alarm, { ro: 'merită văzut', en: 'worth watching' });
  assert.deepEqual(out.narrator, { ro: 'gemini', en: 'gemini' });
  // RO untouched
  assert.equal(out.headline.ro, legacyDigest.headline);
  assert.equal(out.matches[0].score[0], 1);
});

test('reconstructFacts pulls the narration-facts shape from a stored day', () => {
  const facts = reconstructFacts(legacyDigest);
  assert.equal(facts.date, '2026-06-12');
  assert.equal(facts.finished[0].id, 1);
  assert.equal(facts.tonight[0].id, 2);
  // ranks are absent in stored days — reconstructed as null, not invented
  assert.equal(facts.tonight[0].homeRank ?? null, null);
  // the canonical RO verdict is injected for the English pass to honor
  assert.equal(facts.tonight[0].verdict, 'worth watching');
});

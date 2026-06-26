import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reuseNarration } from '../pipeline/prose-reuse.js';
import { reuseNarrationEn } from '../pipeline/run.js';

const stored = {
  headline: 'Bosnia sperie Canada ca un urs',
  summary: 'Două propoziții. Exact două.',
  matches: [{ id: 1, home: 'Bosnia', away: 'Canada', pill: 'Pastila 1', drama: 4 }],
  tonight: [{ id: 3, home: 'Brazilia', away: 'Maroc', alarm: 'merită văzut', why: 'Motivul' }],
};

const facts = {
  finished: [{ id: 1, home: 'Bosnia', away: 'Canada' }],
  tonight: [{ id: 3, home: 'Brazilia', away: 'Maroc' }],
};

test('rebuilds narration from a stored digest', () => {
  const narration = reuseNarration(stored, facts);
  assert.deepEqual(narration, {
    headline: 'Bosnia sperie Canada ca un urs',
    summary: 'Două propoziții. Exact două.',
    matches: [{ id: 1, pill: 'Pastila 1', drama: 4 }],
    tonight: [{ id: 3, alarm: 'merită văzut', why: 'Motivul' }],
    groups: [],
  });
});

test('falls back to home+away matching for legacy tonight entries without id', () => {
  const legacy = structuredClone(stored);
  delete legacy.tonight[0].id;
  const narration = reuseNarration(legacy, facts);
  assert.deepEqual(narration.tonight, [{ id: 3, alarm: 'merită văzut', why: 'Motivul' }]);
});

test('returns null when a finished match has no stored prose', () => {
  const moreFacts = structuredClone(facts);
  moreFacts.finished.push({ id: 2, home: 'Mexic', away: 'Qatar' });
  assert.equal(reuseNarration(stored, moreFacts), null);
});

test('returns null when a tonight fixture has no stored prose', () => {
  const moreFacts = structuredClone(facts);
  moreFacts.tonight.push({ id: 9, home: 'Franța', away: 'Norvegia' });
  assert.equal(reuseNarration(stored, moreFacts), null);
});

test('returns null for a digest without headline or summary', () => {
  assert.equal(reuseNarration({ matches: [], tonight: [] }, facts), null);
  assert.equal(reuseNarration(null, facts), null);
});

const bilingualStored = {
  headline: { ro: 'RO h', en: 'EN h' },
  summary: { ro: 'RO s', en: 'EN s' },
  matches: [{ id: 1, home: 'Bosnia', away: 'Canada', pill: { ro: 'RO p', en: 'EN p' }, drama: 4 }],
  tonight: [{ id: 3, home: 'Brazilia', away: 'Maroc', alarm: { ro: 'merită văzut', en: 'worth watching' }, why: { ro: 'RO w', en: 'EN w' } }],
};

test('reuseNarrationEn rebuilds the English side', () => {
  const en = reuseNarrationEn(bilingualStored, facts);
  assert.deepEqual(en, {
    headline: 'EN h', summary: 'EN s',
    matches: [{ id: 1, pill: 'EN p', drama: 4 }],
    tonight: [{ id: 3, alarm: 'worth watching', why: 'EN w' }],
    groups: [],
  });
});

test('reuseNarrationEn keeps EN when a decisive-group fixture has a blank why', () => {
  // A decisive-matchday fixture stores an intentionally blank `why` (the maths
  // lives in the group paragraph) but still has a real alarm. A blank why must
  // not be read as "EN missing" — that would drop the whole English side.
  const decisive = structuredClone(bilingualStored);
  decisive.tonight[0].why = { ro: '', en: '' };
  decisive.groupScenarios = [{ name: 'A', prose: { ro: 'RO grup', en: 'EN grup' } }];
  const en = reuseNarrationEn(decisive, facts);
  assert.deepEqual(en, {
    headline: 'EN h', summary: 'EN s',
    matches: [{ id: 1, pill: 'EN p', drama: 4 }],
    tonight: [{ id: 3, alarm: 'worth watching', why: '' }],
    groups: [{ name: 'A', scenario: 'EN grup' }],
  });
});

test('reuseNarrationEn returns null for a RO-only stored day', () => {
  const roOnly = { headline: 'RO h', summary: 'RO s', matches: [{ id: 1, pill: 'p', drama: 1 }], tonight: [] };
  assert.equal(reuseNarrationEn(roOnly, { finished: [{ id: 1 }], tonight: [] }), null);
});

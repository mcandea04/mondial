import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayTonightWhy, matchDecisionNote, tonightPhaseLabel } from '../site/assets/render.js';

test('matchDecisionNote formats penalty shootout score separately', () => {
  const match = { decidedAfter: 'penalties', penalties: [4, 2] };
  assert.equal(matchDecisionNote(match, 'ro'), 'după penalty-uri · 4 – 2');
  assert.equal(matchDecisionNote(match, 'en'), 'after penalties · 4 – 2');
});

test('matchDecisionNote formats extra time and hides regular time', () => {
  assert.equal(matchDecisionNote({ decidedAfter: 'extraTime' }, 'ro'), 'după prelungiri');
  assert.equal(matchDecisionNote({ decidedAfter: 'regular' }, 'ro'), '');
  assert.equal(matchDecisionNote({}, 'en'), '');
});

test('tonightPhaseLabel summarizes unique upcoming stages', () => {
  const tonight = [
    { stage: 'round-of-32' },
    { stage: 'round-of-32' },
    { stage: 'round-of-16' },
    { stage: null },
  ];
  assert.equal(tonightPhaseLabel(tonight, 'ro'), 'șaisprezecimi / optimi');
  assert.equal(tonightPhaseLabel(tonight, 'en'), 'round of 32 / round of 16');
  assert.equal(tonightPhaseLabel([{ stage: 'third-place' }], 'ro'), 'finala mică');
  assert.equal(tonightPhaseLabel([{ stage: 'third-place' }], 'en'), 'third-place match');
  assert.equal(tonightPhaseLabel([{ stage: null }], 'ro'), '');
});

test('displayTonightWhy removes duplicated Romanian verdict prefixes', () => {
  assert.equal(
    displayTonightWhy({ why: { ro: 'merită văzut: la 20:00, două echipe tari.' } }, 'ro'),
    'La 20:00, două echipe tari.',
  );
  assert.equal(
    displayTonightWhy({ why: { ro: 'citești dimineața: la 04:00, somnul câștigă.' } }, 'ro'),
    'La 04:00, somnul câștigă.',
  );
  assert.equal(
    displayTonightWhy({ why: { ro: 'începe cu literă mică fără verdict.' } }, 'ro'),
    'Începe cu literă mică fără verdict.',
  );
  assert.equal(
    displayTonightWhy({ why: { en: 'Worth watching: two strong teams.', ro: 'fallback' } }, 'en'),
    'Worth watching: two strong teams.',
  );
});

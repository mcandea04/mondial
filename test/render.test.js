import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchDecisionNote, tonightPhaseLabel } from '../site/assets/render.js';

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
  assert.equal(tonightPhaseLabel([{ stage: null }], 'ro'), '');
});

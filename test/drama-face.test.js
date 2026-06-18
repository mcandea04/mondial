// test/drama-face.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampDrama } from '../site/assets/render.js';

test('clampDrama returns the integer rating, clamped to 1-5', () => {
  assert.equal(clampDrama(1), 1);
  assert.equal(clampDrama(2), 2);
  assert.equal(clampDrama(3), 3);
  assert.equal(clampDrama(4), 4);
  assert.equal(clampDrama(5), 5);
});

test('clampDrama caps above-range ratings at 5', () => {
  assert.equal(clampDrama(6), 5);
  assert.equal(clampDrama(7), 5);
});

test('clampDrama floors a fractional rating', () => {
  assert.equal(clampDrama(2.9), 2);
});

test('clampDrama returns null for absent or non-positive ratings', () => {
  assert.equal(clampDrama(0), null);
  assert.equal(clampDrama(-2), null);
  assert.equal(clampDrama(undefined), null);
  assert.equal(clampDrama(null), null);
  assert.equal(clampDrama(NaN), null);
  assert.equal(clampDrama('3'), null);
});

// test/drama-face.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dramaFace, clampDrama } from '../site/assets/render.js';

test('dramaFace maps each rating to its thermal face', () => {
  assert.equal(dramaFace(1), '🥶');
  assert.equal(dramaFace(2), '😐');
  assert.equal(dramaFace(3), '🥵');
  assert.equal(dramaFace(4), '🤯');
  assert.equal(dramaFace(5), '🤯');
});

test('dramaFace clamps above-range ratings to the top face', () => {
  assert.equal(dramaFace(6), '🤯');
  assert.equal(dramaFace(7), '🤯');
});

test('dramaFace floors a fractional rating before mapping', () => {
  assert.equal(dramaFace(2.9), '😐');
});

test('dramaFace returns null for absent or non-positive ratings', () => {
  assert.equal(dramaFace(0), null);
  assert.equal(dramaFace(-2), null);
  assert.equal(dramaFace(undefined), null);
  assert.equal(dramaFace(null), null);
  assert.equal(dramaFace(NaN), null);
  assert.equal(dramaFace('3'), null);
});

test('clampDrama returns the integer rating, clamped to 1-5, null when no face', () => {
  assert.equal(clampDrama(3), 3);
  assert.equal(clampDrama(7), 5);
  assert.equal(clampDrama(2.9), 2);
  assert.equal(clampDrama(0), null);
  assert.equal(clampDrama(-2), null);
  assert.equal(clampDrama(undefined), null);
});

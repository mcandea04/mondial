// test/segmented.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextOnClick } from '../site/assets/segmented.js';

// nextOnClick(clickedValue, activeValue) returns the value to select, or null
// when the click is a no-op (clicking the already-active segment).
test('clicking an inactive segment selects it', () => {
  assert.equal(nextOnClick('en', 'ro'), 'en');
});

test('clicking the active segment is a no-op', () => {
  assert.equal(nextOnClick('ro', 'ro'), null);
});

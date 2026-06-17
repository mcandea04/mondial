// test/i18n.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localize, alarmIsWatch, UI_STRINGS, STATUS_LABEL, dateLabel } from '../site/assets/i18n.js';

test('localize: legacy string passes through unchanged', () => {
  assert.equal(localize('salut', 'en'), 'salut');
});

test('localize: object picks active language', () => {
  assert.equal(localize({ ro: 'salut', en: 'hello' }, 'en'), 'hello');
  assert.equal(localize({ ro: 'salut', en: 'hello' }, 'ro'), 'salut');
});

test('localize: falls back to ro when en missing', () => {
  assert.equal(localize({ ro: 'salut' }, 'en'), 'salut');
});

test('localize: empty for null/undefined', () => {
  assert.equal(localize(null, 'en'), '');
  assert.equal(localize(undefined, 'ro'), '');
});

test('alarmIsWatch recognizes both languages and the legacy RO token', () => {
  assert.equal(alarmIsWatch('merită văzut'), true);
  assert.equal(alarmIsWatch('stai treaz'), true); // legacy archive value
  assert.equal(alarmIsWatch('stay up'), true);
  assert.equal(alarmIsWatch('citești dimineața'), false);
  assert.equal(alarmIsWatch('read in the morning'), false);
});

test('UI_STRINGS has parallel keys in both languages', () => {
  const roKeys = Object.keys(UI_STRINGS.ro).sort();
  const enKeys = Object.keys(UI_STRINGS.en).sort();
  assert.deepEqual(roKeys, enKeys);
});

test('STATUS_LABEL covers all four statuses in both languages', () => {
  for (const status of ['calificată', 'în cărți', 'are nevoie de minune', 'eliminată']) {
    assert.ok(STATUS_LABEL.ro[status]);
    assert.ok(STATUS_LABEL.en[status]);
  }
});

test('dateLabel returns a capitalized localized weekday', () => {
  const ro = dateLabel('2026-06-17', 'ro');
  const en = dateLabel('2026-06-17', 'en');
  assert.equal(ro[0], ro[0].toUpperCase());
  assert.match(en, /June|Jun/);
});

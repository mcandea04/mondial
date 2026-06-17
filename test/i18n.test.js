// test/i18n.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localize, localizeTeam, alarmIsWatch, alarmBadgeLabel, UI_STRINGS, STATUS_LABEL, dateLabel } from '../site/assets/i18n.js';

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
  assert.equal(alarmIsWatch('worth watching'), true);
  assert.equal(alarmIsWatch('citești dimineața'), false);
  assert.equal(alarmIsWatch('catch it later'), false);
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
  // 17 June 2026 is a Wednesday — RO and EN must name the same day differently.
  assert.match(ro, /[Mm]iercuri/);
  assert.match(en, /Wednesday/);
});

test('localizeTeam maps Romanian exonyms to English, RO passes through', () => {
  assert.equal(localizeTeam('Olanda', 'en'), 'Netherlands');
  assert.equal(localizeTeam('Coasta de Fildeș', 'en'), 'Ivory Coast');
  assert.equal(localizeTeam('Anglia', 'en'), 'England');
  assert.equal(localizeTeam('Olanda', 'ro'), 'Olanda'); // RO keeps the exonym
  assert.equal(localizeTeam('Brazilia', 'ro'), 'Brazilia');
});

test('localizeTeam passes unknown names through (knockout placeholders)', () => {
  assert.equal(localizeTeam('Winner Group A', 'en'), 'Winner Group A');
  assert.equal(localizeTeam('Qatar', 'en'), 'Qatar'); // same in both languages
});

test('alarmBadgeLabel gives the canonical verdict label per language', () => {
  assert.equal(alarmBadgeLabel(true, 'ro'), 'merită văzut');
  assert.equal(alarmBadgeLabel(false, 'ro'), 'citești dimineața');
  assert.equal(alarmBadgeLabel(true, 'en'), 'worth watching');
  assert.equal(alarmBadgeLabel(false, 'en'), 'catch it later');
});

test('new UI_STRINGS keys are present in both languages', () => {
  for (const key of ['ownGoal', 'penalties', 'drama', 'archiveTitle', 'chooseDay', 'recaps', 'recapLabel', 'alarmWatch', 'alarmSkip']) {
    assert.ok(UI_STRINGS.ro[key], `ro.${key}`);
    assert.ok(UI_STRINGS.en[key], `en.${key}`);
  }
  assert.equal(UI_STRINGS.en.ownGoal, 'own goal');
  assert.equal(UI_STRINGS.en.drama(4), 'drama 4 of 5');
  assert.equal(UI_STRINGS.en.recapLabel, 'Highlights');
  assert.equal(UI_STRINGS.ro.recapLabel, 'Rezumat video');
});

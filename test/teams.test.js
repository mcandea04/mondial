import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { flagCode, teamNameKeys, flagCodeKeys, flagCodeValues } from '../pipeline/teams.js';

const FLAGS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'site', 'assets', 'flags');

test('flagCode returns ISO-2 for a sovereign country', () => {
  assert.equal(flagCode('Mexico'), 'mx');
  assert.equal(flagCode('South Korea'), 'kr');
});

test('flagCode returns flag-icons sub-national codes for home nations', () => {
  assert.equal(flagCode('England'), 'gb-eng');
  assert.equal(flagCode('Scotland'), 'gb-sct');
});

test('flagCode maps the easily-confused codes correctly', () => {
  assert.equal(flagCode('Congo DR'), 'cd');
  assert.equal(flagCode('Curaçao'), 'cw');
  assert.equal(flagCode('Cape Verde Islands'), 'cv');
  assert.equal(flagCode('Ivory Coast'), 'ci');
});

test('flagCode returns null for unknown names (knockout placeholders)', () => {
  assert.equal(flagCode('Winner Group A'), null);
  assert.equal(flagCode('1B'), null);
});

test('every ROMANIAN_NAMES key has a FLAG_CODES entry and vice versa', () => {
  const names = [...teamNameKeys()].sort();
  const codes = [...flagCodeKeys()].sort();
  assert.deepEqual(codes, names);
});

test('every FLAG_CODES value has a byte-exact lowercase SVG on disk', () => {
  const missing = flagCodeValues().filter((code) => !existsSync(join(FLAGS_DIR, `${code}.svg`)));
  assert.deepEqual(missing, [], `missing flag SVGs: ${missing.join(', ')}`);
});

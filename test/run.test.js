import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATE = '2026-06-12';

export function freshDirs() {
  const fixtures = mkdtempSync(path.join(tmpdir(), 'mondial-fixtures-'));
  cpSync(path.join(ROOT, 'test', 'fixtures'), fixtures, { recursive: true });
  const out = mkdtempSync(path.join(tmpdir(), 'mondial-out-'));
  return { fixtures, out };
}

export function runPipeline({ fixtures, out, extra = [] }) {
  return execFileSync(
    'node',
    ['pipeline/run.js', '--fixtures', fixtures, '--date', DATE, '--out', out, ...extra],
    { cwd: ROOT, encoding: 'utf8' },
  );
}

export function readDigest(out) {
  return JSON.parse(readFileSync(path.join(out, `${DATE}.json`), 'utf8'));
}

test('--out redirects all writes and leaves site/data untouched', () => {
  const { fixtures, out } = freshDirs();
  const siteDataPath = path.join(ROOT, 'site', 'data', `${DATE}.json`);
  const before = existsSync(siteDataPath) ? readFileSync(siteDataPath, 'utf8') : null;
  const indexBefore = readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf8');

  runPipeline({ fixtures, out });

  assert.ok(existsSync(path.join(out, `${DATE}.json`)), 'digest written to out dir');
  assert.ok(existsSync(path.join(out, 'latest.json')), 'latest.json written to out dir');
  assert.ok(existsSync(path.join(out, 'manifest.json')), 'manifest written to out dir');
  assert.ok(existsSync(path.join(out, 'og', `${DATE}.png`)), 'og image written to out dir');

  const after = existsSync(siteDataPath) ? readFileSync(siteDataPath, 'utf8') : null;
  assert.equal(after, before, 'site/data digest unchanged');
  assert.equal(readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf8'), indexBefore, 'index.html unchanged');
});

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

function setCannedHeadline(fixtures, headline) {
  const cannedPath = path.join(fixtures, 'narration.json');
  const canned = JSON.parse(readFileSync(cannedPath, 'utf8'));
  canned.headline = headline;
  writeFileSync(cannedPath, JSON.stringify(canned, null, 2));
}

test('same facts: second run reuses prose and ignores new narration', () => {
  const { fixtures, out } = freshDirs();
  runPipeline({ fixtures, out });
  const first = readDigest(out);
  assert.ok(first.factsHash, 'factsHash stored in digest');
  assert.ok(first.tonight.every((t) => t.id != null), 'tonight entries carry ids');

  setCannedHeadline(fixtures, 'Proză nouă care NU trebuie folosită');
  const log = runPipeline({ fixtures, out });
  assert.match(log, /facts unchanged, prose reused/);
  const second = readDigest(out);
  // Freeze guarantee is prose-unchanged, not byte-identical.
  assert.equal(second.headline, first.headline);
  assert.equal(second.summary, first.summary);
  assert.deepEqual(second.matches.map((m) => m.pill), first.matches.map((m) => m.pill));
  assert.deepEqual(second.tonight.map((t) => t.why), first.tonight.map((t) => t.why));
});

test('--re-narrate forces fresh prose even when facts are unchanged', () => {
  const { fixtures, out } = freshDirs();
  runPipeline({ fixtures, out });

  setCannedHeadline(fixtures, 'Proză regenerată la cerere');
  runPipeline({ fixtures, out, extra: ['--re-narrate'] });
  assert.equal(readDigest(out).headline, 'Proză regenerată la cerere');
});

test('changed facts re-narrate automatically', () => {
  const { fixtures, out } = freshDirs();
  runPipeline({ fixtures, out });
  const first = readDigest(out);

  const matchesPath = path.join(fixtures, 'matches.json');
  const matches = JSON.parse(readFileSync(matchesPath, 'utf8'));
  const finished = matches.matches.find((m) => m.status === 'FINISHED');
  finished.score.fullTime.home += 1;
  writeFileSync(matchesPath, JSON.stringify(matches, null, 2));
  setCannedHeadline(fixtures, 'Proză nouă după corecția scorului');

  runPipeline({ fixtures, out });
  const second = readDigest(out);
  assert.notEqual(second.factsHash, first.factsHash);
  assert.equal(second.headline, 'Proză nouă după corecția scorului');
});

test('legacy digest without factsHash is trusted: prose reused, hash stamped', () => {
  const { fixtures, out } = freshDirs();
  runPipeline({ fixtures, out });
  const digestPath = path.join(out, `${DATE}.json`);
  const legacy = JSON.parse(readFileSync(digestPath, 'utf8'));
  const expectedHash = legacy.factsHash;
  delete legacy.factsHash;
  writeFileSync(digestPath, JSON.stringify(legacy, null, 2));

  setCannedHeadline(fixtures, 'Proză nouă care NU trebuie folosită');
  runPipeline({ fixtures, out });
  const after = readDigest(out);
  assert.equal(after.headline, legacy.headline);
  assert.equal(after.factsHash, expectedHash);
});

test('a backfill run for an older date does not clobber a newer latest.json', () => {
  const { fixtures, out } = freshDirs();
  runPipeline({ fixtures, out });
  const newer = { ...readDigest(out), date: '2026-06-13' };
  writeFileSync(path.join(out, 'latest.json'), JSON.stringify(newer, null, 2));

  runPipeline({ fixtures, out, extra: ['--re-narrate'] });
  const latest = JSON.parse(readFileSync(path.join(out, 'latest.json'), 'utf8'));
  assert.equal(latest.date, '2026-06-13');
});

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

export function runPipeline({ fixtures, out, extra = [], env = {} }) {
  return execFileSync(
    'node',
    ['pipeline/run.js', '--fixtures', fixtures, '--date', DATE, '--out', out, ...extra],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } },
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

test('manifest carries per-day recap counts from the FIFA highlights feed', () => {
  const { fixtures, out } = freshDirs();
  runPipeline({ fixtures, out });
  const manifest = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.dates, [DATE]);
  // The highlights.json fixture keys both finished matches.
  assert.equal(manifest.recaps[DATE], 2);
});

test('manifest omits days with no recaps from the recaps map', () => {
  const { fixtures, out } = freshDirs();
  // Empty the highlights feed so no match is linked.
  writeFileSync(path.join(fixtures, 'highlights.json'), JSON.stringify({ items: [] }));
  runPipeline({ fixtures, out });
  const manifest = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.dates, [DATE]);
  assert.equal(manifest.recaps[DATE], undefined);
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

import { mergeHighlight } from '../pipeline/run.js';

test('monotonic merge: stored link survives a feed outage (empty recapByMatch)', () => {
  const stored = new Map([[537327, 'https://www.fifa.com/en/watch/mexSudHighlight']]);
  const fresh = new Map(); // simulated outage
  assert.equal(mergeHighlight(537327, fresh, stored), 'https://www.fifa.com/en/watch/mexSudHighlight');
});

test('monotonic merge: fresh link wins over stored link (correction)', () => {
  const stored = new Map([[537327, 'https://www.fifa.com/en/watch/oldLink']]);
  const fresh = new Map([[537327, 'https://www.fifa.com/en/watch/newLink']]);
  assert.equal(mergeHighlight(537327, fresh, stored), 'https://www.fifa.com/en/watch/newLink');
});

test('monotonic merge: no stored, no fresh -> null', () => {
  const stored = new Map();
  const fresh = new Map();
  assert.equal(mergeHighlight(537327, fresh, stored), null);
});

const oneHighlightFeed = JSON.stringify({
  items: [
    {
      entryId: 'mexSudHighlight',
      title: 'Mexico v South Africa | Group A | FIFA World Cup 2026™ | Highlights',
      semanticTags: [
        { sourceCategory: 'Match', title: 'Mexico v South Africa on 06/11/2026 19:00 UTC', id: '400021443' },
        { sourceCategory: 'Country', title: 'Mexico', id: 'MEX' },
        { sourceCategory: 'Country', title: 'South Africa', id: 'RSA' },
      ],
    },
  ],
});

test('--require-complete: identical second run skips deploy (published=false in log)', () => {
  const { fixtures, out } = freshDirs();
  // First run: no stored digest, always publishes.
  const firstLog = runPipeline({ fixtures, out, extra: ['--require-complete'] });
  assert.match(firstLog, /Done:/);

  // Second run: same fixtures, same stored digest -> gate skips deploy.
  const secondLog = runPipeline({ fixtures, out, extra: ['--require-complete'] });
  assert.match(secondLog, /nothing changed; already published/);
});

test('--require-complete: run after a new highlight link still deploys', () => {
  const { fixtures, out } = freshDirs();
  // Cover only 1 of 2 finished matches.
  writeFileSync(path.join(fixtures, 'highlights.json'), oneHighlightFeed);
  runPipeline({ fixtures, out, extra: ['--require-complete'] });
  const firstDigest = readDigest(out);
  assert.equal(firstDigest.matches.filter((m) => m.highlight).length, 1);

  // Now add the second highlight (default fixture covers both).
  cpSync(path.join(ROOT, 'test', 'fixtures', 'highlights.json'), path.join(fixtures, 'highlights.json'));
  const secondLog = runPipeline({ fixtures, out, extra: ['--require-complete'] });
  // Digest changed (new link added) -> must deploy, not skip.
  assert.doesNotMatch(secondLog, /nothing changed; already published/);
  const secondDigest = readDigest(out);
  assert.equal(secondDigest.matches.filter((m) => m.highlight).length, 2);
});

test('--require-complete: outage after a stored link keeps the link and skips deploy', () => {
  const { fixtures, out } = freshDirs();
  // Cover only 1 of 2 finished matches, publish it.
  writeFileSync(path.join(fixtures, 'highlights.json'), oneHighlightFeed);
  runPipeline({ fixtures, out, extra: ['--require-complete'] });
  assert.equal(readDigest(out).matches.filter((m) => m.highlight).length, 1);

  // Simulated feed outage: empty feed must not wipe the stored link.
  writeFileSync(path.join(fixtures, 'highlights.json'), JSON.stringify({ items: [] }));
  const log = runPipeline({ fixtures, out, extra: ['--require-complete'] });
  assert.equal(readDigest(out).matches.filter((m) => m.highlight).length, 1);
  assert.match(log, /nothing changed; already published/);
});

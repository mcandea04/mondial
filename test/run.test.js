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

export function runPipeline({ fixtures, out, extra = [], env = {}, date = DATE }) {
  return execFileSync(
    'node',
    ['pipeline/run.js', '--fixtures', fixtures, '--date', date, '--out', out, ...extra],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } },
  );
}

export function readDigest(out, date = DATE) {
  return JSON.parse(readFileSync(path.join(out, `${date}.json`), 'utf8'));
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
  assert.deepEqual(second.headline, first.headline);
  assert.deepEqual(second.summary, first.summary);
  assert.deepEqual(second.matches.map((m) => m.pill), first.matches.map((m) => m.pill));
  assert.deepEqual(second.tonight.map((t) => t.why), first.tonight.map((t) => t.why));
});

test('--re-narrate forces fresh prose even when facts are unchanged', () => {
  const { fixtures, out } = freshDirs();
  runPipeline({ fixtures, out });

  setCannedHeadline(fixtures, 'Proză regenerată la cerere');
  runPipeline({ fixtures, out, extra: ['--re-narrate'] });
  assert.equal(readDigest(out).headline.ro, 'Proză regenerată la cerere');
});

// The assist on Giménez's 12' goal (match 760414) comes from the second
// participant of the Goal keyEvent in this summary fixture. Rewriting it
// simulates ESPN revising a soft field between polls.
function setSummaryAssist(fixtures, assistName) {
  const summaryPath = path.join(fixtures, 'summary-760414.json');
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  const goal = summary.keyEvents.find((e) => e.type?.text === 'Goal' && e.scoringPlay);
  goal.participants[1].athlete.displayName = assistName;
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
}

test('a late assist correction reuses prose but still publishes the new assist', () => {
  const { fixtures, out } = freshDirs();
  runPipeline({ fixtures, out });
  const first = readDigest(out);
  const firstScorer = first.matches.find((m) => m.id === 760414).scorers.find((s) => s.assist);
  assert.equal(firstScorer.assist, 'Lozano', 'baseline assist published');

  // ESPN revises only the assist (a soft field) and we offer different prose.
  setSummaryAssist(fixtures, 'Vega');
  setCannedHeadline(fixtures, 'Proză nouă care NU trebuie folosită');
  const log = runPipeline({ fixtures, out });

  // The narrated facts are unchanged, so the prose is frozen and not re-narrated.
  assert.match(log, /facts unchanged, prose reused/);
  const second = readDigest(out);
  assert.equal(second.factsHash, first.factsHash, 'soft-field change leaves the hash');
  assert.deepEqual(second.headline, first.headline, 'prose reused, canned headline ignored');

  // But the corrected assist still flows into the published JSON.
  const secondScorer = second.matches.find((m) => m.id === 760414).scorers.find((s) => s.name === firstScorer.name);
  assert.equal(secondScorer.assist, 'Vega', 'corrected assist published despite prose reuse');
});

test('changed facts re-narrate automatically', () => {
  const { fixtures, out } = freshDirs();
  runPipeline({ fixtures, out });
  const first = readDigest(out);

  // Mutate a completed event's score in the ESPN-shaped scoreboard fixture.
  const boardPath = path.join(fixtures, 'scoreboard.json');
  const board = JSON.parse(readFileSync(boardPath, 'utf8'));
  // 760414 (Mexico v South Africa) appears in both date boards; update both.
  for (const dateKey of Object.keys(board)) {
    const event = board[dateKey].events.find((e) => e.id === '760414' && e.status?.type?.completed);
    if (event) {
      const home = event.competitions[0].competitors.find((c) => c.homeAway === 'home');
      home.score = String(Number(home.score) + 1);
    }
  }
  writeFileSync(boardPath, JSON.stringify(board, null, 2));
  setCannedHeadline(fixtures, 'Proză nouă după corecția scorului');

  runPipeline({ fixtures, out });
  const second = readDigest(out);
  assert.notEqual(second.factsHash, first.factsHash);
  assert.equal(second.headline.ro, 'Proză nouă după corecția scorului');
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
  assert.deepEqual(after.headline, legacy.headline);
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

test('offline run with bilingual fixtures produces {ro,en} prose fields', () => {
  const { fixtures, out } = freshDirs();
  runPipeline({ fixtures, out });
  const digest = readDigest(out);
  assert.equal(typeof digest.headline, 'object');
  // RO comes from narration.json, EN from narration.en.json — pin both canned values.
  assert.equal(digest.headline.ro, 'Mexicul scapă cu emoții, Canada calcă apăsat');
  assert.equal(digest.headline.en, 'Mexico survive a scare, Canada march on');
  assert.equal(typeof digest.narrator, 'object');
  assert.ok(digest.matches.every((m) => typeof m.pill === 'object'));
  assert.ok(digest.tonight.every((t) => typeof t.alarm === 'object' && typeof t.why === 'object'));
  assert.ok(digest.teaser.ro && digest.teaser.en);
});

test('FIFA ranks feed the narrator but never leak into the published digest', () => {
  const { fixtures, out } = freshDirs();
  runPipeline({ fixtures, out });
  const raw = readFileSync(path.join(out, `${DATE}.json`), 'utf8');
  assert.equal(raw.includes('homeRank'), false, 'homeRank must not appear in published JSON');
  assert.equal(raw.includes('awayRank'), false, 'awayRank must not appear in published JSON');
  assert.equal(raw.includes('"rank"'), false, 'standings rank must not appear in published JSON');
  assert.equal(raw.includes('goalFacts'), false, 'goalFacts must not appear in published JSON');
});

import { goalFactsForMatch, mergeHighlight, mergeEnrichment, withoutGold } from '../pipeline/run.js';

test('goalFactsForMatch computes brace/different-scorer facts and keeps own goals separate', () => {
  const facts = goalFactsForMatch({
    home: 'Norvegia',
    away: 'Senegal',
    score: [3, 1],
    scorers: [
      { name: 'Erling Haaland', minute: '48', team: 'home', ownGoal: false },
      { name: 'Erling Haaland', minute: '58', team: 'home', ownGoal: false },
      { name: 'Kalidou Koulibaly', minute: '70', team: 'home', ownGoal: true },
      { name: 'Ismaïla Sarr', minute: '90+3', team: 'away', ownGoal: false },
    ],
  });

  assert.equal(facts.totalGoals, 4);
  assert.equal(facts.recordedGoals, 4);
  assert.deepEqual(facts.multiGoalPlayers, [
    { name: 'Erling Haaland', side: 'home', team: 'Norvegia', goals: 2, minutes: ['48', '58'] },
  ]);
  assert.equal(facts.allScorersDifferent, false);
  assert.deepEqual(facts.byTeam[0].ownGoals, [{ name: 'Kalidou Koulibaly', minute: '70' }]);
});

test('goalFactsForMatch marks allScorersDifferent only when every non-own-goal scorer is unique', () => {
  const facts = goalFactsForMatch({
    home: 'Mexic',
    away: 'Cehia',
    score: [2, 1],
    scorers: [
      { name: 'A', minute: '10', team: 'home', ownGoal: false },
      { name: 'B', minute: '20', team: 'home', ownGoal: false },
      { name: 'C', minute: '30', team: 'away', ownGoal: false },
    ],
  });

  assert.equal(facts.allScorersDifferent, true);
  assert.deepEqual(facts.multiGoalPlayers, []);
});

test('2026-06-29 and later run in knockout mode', () => {
  const { fixtures, out } = freshDirs();
  const date = '2026-06-29';
  const event = {
    id: '760486',
    name: 'Canada at South Africa',
    date: '2026-06-28T19:00:00Z',
    season: { year: 2026, type: 13801, slug: 'round-of-32' },
    status: { type: { state: 'post', completed: true } },
    competitions: [{ competitors: [
      { homeAway: 'home', score: '0', winner: false, team: { id: '467', displayName: 'South Africa' } },
      { homeAway: 'away', score: '1', winner: true, team: { id: '206', displayName: 'Canada' } },
    ] }],
  };
  const tonight = [
    {
      id: '760487',
      name: 'Japan at Brazil',
      date: '2026-06-29T17:00:00Z',
      season: { year: 2026, type: 13801, slug: 'round-of-32' },
      status: { type: { state: 'pre', completed: false } },
      competitions: [{ competitors: [
        { homeAway: 'home', team: { id: '20', displayName: 'Brazil' } },
        { homeAway: 'away', team: { id: '21', displayName: 'Japan' } },
      ] }],
    },
    {
      id: '760489',
      name: 'Paraguay at Germany',
      date: '2026-06-29T20:30:00Z',
      season: { year: 2026, type: 13801, slug: 'round-of-32' },
      status: { type: { state: 'pre', completed: false } },
      competitions: [{ competitors: [
        { homeAway: 'home', team: { id: '22', displayName: 'Germany' } },
        { homeAway: 'away', team: { id: '23', displayName: 'Paraguay' } },
      ] }],
    },
  ];
  writeFileSync(path.join(fixtures, 'scoreboard.json'), JSON.stringify({
    20260628: { events: [event] },
    20260629: { events: tonight },
    20260630: { events: [] },
  }));
  writeFileSync(path.join(fixtures, 'espn-standings.json'), JSON.stringify({
    children: [{
      name: 'Group A',
      standings: { entries: [
        { team: { displayName: 'South Africa' }, stats: [{ name: 'gamesPlayed', value: 3 }, { name: 'points', value: 4 }] },
        { team: { displayName: 'Canada' }, stats: [{ name: 'gamesPlayed', value: 3 }, { name: 'points', value: 4 }] },
      ] },
    }],
  }));
  writeFileSync(path.join(fixtures, 'summary-760486.json'), JSON.stringify({
    header: { competitions: event.competitions },
    keyEvents: [
      {
        team: { id: '206' },
        clock: { displayValue: "90'+2'" },
        type: { text: 'Goal' },
        scoringPlay: true,
        participants: [{ athlete: { displayName: 'Stephen Eustáquio' } }],
        text: 'Stephen Eustáquio scores.',
      },
    ],
    boxscore: { teams: [] },
  }));
  writeFileSync(path.join(fixtures, 'narration.json'), JSON.stringify({
    headline: 'Canada merge mai departe',
    summary: 'Canada a câștigat în prelungiri. Africa de Sud a fost eliminată.',
    matches: [{ id: 760486, pill: 'Canada avansează în optimi, Africa de Sud pleacă acasă.', drama: 4 }],
    tonight: [
      { id: 760487, alarm: 'merită văzut', why: 'Brazilia și Japonia joacă la 20:00 cu eliminarea pe masă.' },
      { id: 760489, alarm: 'citești dimineața', why: 'Germania și Paraguay vin târziu, iar scorul îl prinzi dimineața.' },
    ],
  }));

  runPipeline({ fixtures, out, date });
  const digest = readDigest(out, date);
  assert.deepEqual(digest.groups, []);
  assert.equal(digest.groupScenarios, undefined);

  const match = digest.matches[0];
  assert.equal(match.stage, 'round-of-32');
  assert.equal(match.winnerAdvancesTo, 'round-of-16');
  assert.equal(match.group, null);
  assert.equal(match.winner, 'Canada');
  assert.equal(match.loser, 'Africa de Sud');
  assert.equal(match.pill.ro.includes('ambele'), false);

  assert.ok(digest.tonight.length > 0);
  assert.ok(digest.tonight.every((fixture) => fixture.stage === 'round-of-32'));
  assert.ok(digest.tonight.every((fixture) => fixture.winnerAdvancesTo === 'round-of-16'));
  assert.ok(digest.tonight.every((fixture) => fixture.group === null));
  assert.ok(digest.tonight.every((fixture) => !('homeScenario' in fixture) && !('awayScenario' in fixture)));
});

test('withoutGold removes promoted lines from the avoid-list', () => {
  const recent = ['o frază veche', 'linia de aur', 'altă frază'];
  const gold = [{ field: 'pill', text: 'linia de aur' }];
  assert.deepEqual(withoutGold(recent, gold), ['o frază veche', 'altă frază']);
});

test('withoutGold is a no-op when gold is empty', () => {
  const recent = ['a', 'b'];
  assert.deepEqual(withoutGold(recent, []), ['a', 'b']);
});

test('mergeEnrichment: a blackout poll keeps prior scorers/events; stats left for mergeStats', () => {
  const stored = new Map([[1, {
    id: 1,
    scorers: [{ name: 'Lozano', minute: '88', team: 'home', penalty: false, ownGoal: false, assist: null, bodyPart: null, placement: null }],
    events: [{ name: 'Mokoena', minute: '79', team: 'away', reason: null }],
    stats: { home: { possessionPct: '55.0' }, away: { possessionPct: '45.0' } },
  }]]);
  const blackout = { id: 1, score: [2, 1], scorers: [], events: [], stats: null };
  const merged = mergeEnrichment(blackout, stored);
  assert.deepEqual(merged.scorers, stored.get(1).scorers);
  assert.deepEqual(merged.events, stored.get(1).events);
  // mergeEnrichment no longer touches stats — mergeStats handles that separately
  assert.equal(merged.stats, null);
  assert.deepEqual(merged.score, [2, 1]); // score is always fresh
});

test('mergeEnrichment: a fresh enriched poll is left untouched (no downgrade case)', () => {
  const stored = new Map([[1, { id: 1, scorers: [{ name: 'Old' }], events: [], stats: null }]]);
  const fresh = { id: 1, score: [1, 0], scorers: [{ name: 'New', minute: '5' }], events: [], stats: null };
  assert.equal(mergeEnrichment(fresh, stored), fresh);
});

test('mergeEnrichment: no prior entry returns the match as-is', () => {
  const empty = { id: 9, scorers: [], events: [], stats: null };
  assert.equal(mergeEnrichment(empty, new Map()), empty);
});

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

import { mergeStats } from '../pipeline/run.js';

test('mergeStats: prior non-null stats lock — fresh stats are discarded', () => {
  const prior = { home: { possessionPct: '55.0' }, away: { possessionPct: '45.0' } };
  const fresh = { home: { possessionPct: '54.7' }, away: { possessionPct: '45.3' } };
  assert.deepEqual(mergeStats(fresh, prior), prior);
});

test('mergeStats: prior null — fresh stats fill once', () => {
  const fresh = { home: { possessionPct: '54.7' }, away: { possessionPct: '45.3' } };
  assert.deepEqual(mergeStats(fresh, null), fresh);
  assert.deepEqual(mergeStats(fresh, undefined), fresh);
});

test('mergeEnrichment: scorers/events restored on blackout but stats not touched', () => {
  const match = { id: 1, scorers: [], events: [], stats: null };
  const prior = new Map([[1, { scorers: [{ name: 'X' }], events: [], stats: { home: { possessionPct: '55.0' } } }]]);
  const result = mergeEnrichment(match, prior);
  // scorers/events are restored (unchanged behavior)
  assert.equal(result.scorers.length, 1);
  // stats NOT touched by mergeEnrichment — stays as fresh value (null here)
  assert.equal(result.stats, null);
});

import { readFile as readFileAsync, writeFile as writeFileAsync, mkdir as mkdirAsync, rm as rmAsync } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

test('stats freeze: second poll with refined possession produces byte-identical digest', async () => {
  // This test runs two offline pipeline passes over the same date.
  // Poll 1: possession is 58.2%/41.8%
  // Poll 2: possession is updated to 57.9%/42.1% (ESPN post-match refinement)
  // After poll 1, the stats block is locked. Poll 2 must produce an identical digest JSON.

  const outDir = path.join(ROOT, 'tmp', 'stats-freeze-test');
  await mkdirAsync(outDir, { recursive: true });

  const fixtureBase = path.join(ROOT, 'test', 'fixtures');
  const scoreboard = JSON.parse(await readFileAsync(path.join(fixtureBase, 'scoreboard.json'), 'utf8'));
  const summary1 = JSON.parse(await readFileAsync(path.join(fixtureBase, 'summary-760414.json'), 'utf8'));
  const standings = JSON.parse(await readFileAsync(path.join(fixtureBase, 'espn-standings.json'), 'utf8'));

  // Poll 2 summary has tweaked possession
  const summary2 = JSON.parse(JSON.stringify(summary1));
  summary2.boxscore.teams[0].statistics.find((s) => s.name === 'possessionPct').displayValue = '57.9';
  summary2.boxscore.teams[1].statistics.find((s) => s.name === 'possessionPct').displayValue = '42.1';

  const poll1Dir = path.join(outDir, 'poll1');
  const poll2Dir = path.join(outDir, 'poll2');
  await mkdirAsync(poll1Dir, { recursive: true });
  await mkdirAsync(poll2Dir, { recursive: true });

  for (const d of [poll1Dir, poll2Dir]) {
    await writeFileAsync(path.join(d, 'scoreboard.json'), JSON.stringify(scoreboard));
    await writeFileAsync(path.join(d, 'espn-standings.json'), JSON.stringify(standings));
    await writeFileAsync(path.join(d, 'narration.json'), await readFileAsync(path.join(fixtureBase, 'narration.json'), 'utf8'));
    // copy the English narration too, so the freeze is exercised on a bilingual digest
    await writeFileAsync(path.join(d, 'narration.en.json'), await readFileAsync(path.join(fixtureBase, 'narration.en.json'), 'utf8'));
    // copy summary-760415 so both matches have enrichment
    await writeFileAsync(path.join(d, 'summary-760415.json'), await readFileAsync(path.join(fixtureBase, 'summary-760415.json'), 'utf8'));
  }
  await writeFileAsync(path.join(poll1Dir, 'summary-760414.json'), JSON.stringify(summary1));
  await writeFileAsync(path.join(poll2Dir, 'summary-760414.json'), JSON.stringify(summary2));

  // Run poll 1
  await execFileAsync('node', [
    path.join(ROOT, 'pipeline', 'run.js'),
    '--fixtures', poll1Dir,
    '--date', '2026-06-12',
    '--out', outDir,
  ]);

  const after1 = await readFileAsync(path.join(outDir, '2026-06-12.json'), 'utf8');
  const digest1 = JSON.parse(after1);
  assert.equal(digest1.matches[0].stats?.home?.possessionPct, '58.2', 'poll 1 should record 58.2');

  // Run poll 2 — same outDir so run.js reads the poll-1 digest as "existing"
  await execFileAsync('node', [
    path.join(ROOT, 'pipeline', 'run.js'),
    '--fixtures', poll2Dir,
    '--date', '2026-06-12',
    '--out', outDir,
  ]);

  const after2 = await readFileAsync(path.join(outDir, '2026-06-12.json'), 'utf8');
  assert.equal(after1, after2, 'digest should be byte-identical after possession refinement (stats frozen)');

  // Cleanup
  await rmAsync(outDir, { recursive: true, force: true });
});

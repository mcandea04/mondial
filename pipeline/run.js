/**
 * Daily digest orchestrator.
 *
 * Usage:
 *   node pipeline/run.js                         # live run for the active digest date
 *   node pipeline/run.js --date 2026-06-12       # live run for a given date
 *   node pipeline/run.js --require-complete       # no-op unless the night is over
 *   node pipeline/run.js --fixtures test/fixtures --date 2026-06-12
 *     # offline run: reads matches.json / standings.json / narration.json
 *     # from the fixtures dir instead of calling the APIs
 *   node pipeline/run.js --out tmp/out          # redirect all data writes to a
 *     # given dir and skip the live index.html OG mutation; fixtures runs default
 *     # to tmp/out/ when --out is omitted
 *   node pipeline/run.js --re-narrate           # (reserved) force fresh narration
 *   node pipeline/run.js --steer "<text>"       # (reserved) steer the narration
 *
 * With --require-complete the run exits 0 without writing anything when not all
 * of the night's matches have finished (used by the polling workflow). When it
 * does publish, it prints "published=true" to $GITHUB_OUTPUT so the workflow can
 * gate the notification step.
 *
 * On any failure the existing site/data/latest.json is left untouched and the
 * process exits non-zero, so the workflow skips commit + deploy.
 */

import { readFile, writeFile, mkdir, readdir, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchDigestData,
  fetchNightMatches,
  digestReadiness,
  selectDigestMatches,
  parseMatch,
  parseFixture,
  parseStandings,
  activeDigestDate,
  kickoffEEST,
} from './fetch.js';
import { classifyStandings } from './standings.js';
import { narrate } from './narrate.js';
import { renderOgImage } from './og-image.js';
import { buildTeaser } from './teaser.js';
import { factsHash } from './facts-hash.js';
import { reuseNarration } from './prose-reuse.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE_DIR = path.join(ROOT, 'site');
const DATA_DIR = path.join(SITE_DIR, 'data');

function parseArgs(argv) {
  const args = { date: null, fixtures: null, requireComplete: false, out: null, reNarrate: false, steer: null };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--date') args.date = argv[++i];
    else if (argv[i] === '--fixtures') args.fixtures = argv[++i];
    else if (argv[i] === '--require-complete') args.requireComplete = true;
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--re-narrate') args.reNarrate = true;
    else if (argv[i] === '--steer') args.steer = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

/** Loads .env into process.env (without overriding) when present. */
async function loadDotEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!existsSync(envPath)) return;
  const lines = (await readFile(envPath, 'utf8')).split('\n');
  for (const line of lines) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !(match[1] in process.env)) {
      process.env[match[1]] = match[2];
    }
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readJsonOrNull(filePath) {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

/** Writes only when content differs from what is on disk. */
async function writeIfChanged(filePath, content) {
  try {
    const current = await readFile(filePath);
    if (Buffer.compare(current, Buffer.from(content)) === 0) return;
  } catch {
    // missing file: fall through to write
  }
  await writeFile(filePath, content);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * Writes a step output for GitHub Actions when $GITHUB_OUTPUT is set, using the
 * heredoc form so values with special characters (a headline) are safe. No-op
 * locally.
 */
async function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const delimiter = `ghadelim_${name}`;
  await appendFile(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

async function gatherFacts({ date, fixtures }) {
  if (fixtures) {
    const matchesResponse = await readJson(path.join(fixtures, 'matches.json'));
    const standingsResponse = await readJson(path.join(fixtures, 'standings.json'));
    const { finished, tonight } = selectDigestMatches(matchesResponse, date);
    return {
      finished: finished.map(parseMatch),
      tonight: tonight.map(parseFixture),
      standings: parseStandings(standingsResponse),
    };
  }
  return fetchDigestData({ digestDate: date, token: requireEnv('FOOTBALL_DATA_TOKEN') });
}

async function getNarration(facts, { fixtures, recentProse, steer }) {
  if (fixtures) {
    const cannedPath = path.join(fixtures, 'narration.json');
    if (existsSync(cannedPath)) return readJson(cannedPath);
  }
  return narrate(facts, {
    apiKey: requireEnv('GEMINI_API_KEY'),
    model: process.env.GEMINI_MODEL || undefined,
    recentProse,
    steer,
  });
}

/**
 * Collects the prose (headline, summary, pills, tonight reasons) from the most
 * recent per-day digests so narration can be told not to recycle the same jokes
 * and metaphors. The model has no memory across daily runs on its own.
 */
async function recentProseBefore(dataDir, date, days = 3) {
  if (!existsSync(dataDir)) return [];
  const files = (await readdir(dataDir))
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .map((name) => name.replace('.json', ''))
    .filter((d) => d < date)
    .sort()
    .slice(-days);

  const prose = [];
  for (const d of files) {
    const digest = await readJson(path.join(dataDir, `${d}.json`));
    prose.push(digest.headline, digest.summary);
    for (const m of digest.matches ?? []) prose.push(m.pill);
    for (const t of digest.tonight ?? []) prose.push(t.why);
  }
  return prose.filter(Boolean);
}

/** Replaces the OG block in index.html between the og:start/og:end markers. */
export function injectOgTags(html, { title, description, image, url }) {
  const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  const block = [
    '<!-- og:start -->',
    `  <meta property="og:title" content="${esc(title)}" />`,
    `  <meta property="og:description" content="${esc(description)}" />`,
    `  <meta property="og:image" content="${esc(image)}" />`,
    `  <meta property="og:url" content="${esc(url)}" />`,
    '  <meta property="og:type" content="website" />',
    '  <!-- og:end -->',
  ].join('\n');
  return html.replace(/<!-- og:start -->[\s\S]*?<!-- og:end -->/, block);
}

async function main() {
  const args = parseArgs(process.argv);
  const steer = (args.steer ?? '').replace(/<!--[\s\S]*?-->/g, '').trim() || null;
  await loadDotEnv();

  const date = args.date ?? activeDigestDate();
  const dataDir = args.out
    ? path.resolve(args.out)
    : args.fixtures
      ? path.join(ROOT, 'tmp', 'out')
      : DATA_DIR;
  const siteUrl = process.env.SITE_URL ?? 'https://mcandea04.github.io/mondial/';

  console.log(`Building digest for ${date}${args.fixtures ? ' (fixtures mode)' : ''}`);

  // Polling gate: only proceed once every match of the night has finished.
  if (args.requireComplete && !args.fixtures) {
    const matches = await fetchNightMatches({ digestDate: date, token: requireEnv('FOOTBALL_DATA_TOKEN') });
    const readiness = digestReadiness(matches);
    if (!readiness.ready) {
      console.log(`Not ready: ${readiness.reason}. Exiting without changes.`);
      await setOutput('published', 'false');
      return;
    }
    console.log(`Ready: ${readiness.reason}.`);
  }

  const facts = await gatherFacts({ date, fixtures: args.fixtures });
  const standings = classifyStandings(facts.standings);

  // Only groups that played last night get a snapshot on the page.
  const groupsThatPlayed = new Set(facts.finished.map((m) => m.group).filter(Boolean));

  const factsForNarration = { date, finished: facts.finished, tonight: facts.tonight, standings };
  const hash = factsHash(factsForNarration);

  // Freeze: when the stored digest was built from the same facts, reuse its
  // prose instead of regenerating. A stored digest without factsHash predates
  // this mechanism and is trusted as-is (the hash gets stamped on rewrite).
  let narration = null;
  let reused = false;
  if (!args.reNarrate) {
    const existing = await readJsonOrNull(path.join(dataDir, `${date}.json`));
    if (existing && (!existing.factsHash || existing.factsHash === hash)) {
      narration = reuseNarration(existing, facts);
      reused = narration != null;
    }
  }

  if (reused) {
    console.log('facts unchanged, prose reused');
  } else {
    const recentProse = args.fixtures ? [] : await recentProseBefore(dataDir, date);
    narration = await getNarration(factsForNarration, {
      fixtures: args.fixtures,
      recentProse,
      steer,
    });
  }

  const narrationByMatch = new Map(narration.matches.map((m) => [m.id, m]));
  const narrationByFixture = new Map(narration.tonight.map((m) => [m.id, m]));

  const digest = {
    date,
    factsHash: hash,
    headline: narration.headline,
    summary: narration.summary,
    matches: facts.finished.map((m) => ({
      ...m,
      pill: narrationByMatch.get(m.id)?.pill ?? '',
      drama: narrationByMatch.get(m.id)?.drama ?? 1,
    })),
    groups: standings.filter((g) => groupsThatPlayed.has(g.name)),
    tonight: facts.tonight.map((m) => ({
      id: m.id,
      home: m.home,
      away: m.away,
      kickoffEEST: m.kickoffEEST ?? kickoffEEST(m.utcDate),
      alarm: narrationByFixture.get(m.id)?.alarm ?? 'citești dimineața',
      why: narrationByFixture.get(m.id)?.why ?? '',
    })),
    teaser: buildTeaser({
      headline: narration.headline,
      matchCount: facts.finished.length,
      siteUrl,
    }),
  };

  await mkdir(path.join(dataDir, 'og'), { recursive: true });

  const ogPath = path.join(dataDir, 'og', `${date}.png`);
  if (!reused || !existsSync(ogPath)) {
    const png = await renderOgImage({
      date,
      headline: narration.headline,
      matches: digest.matches,
    });
    await writeIfChanged(ogPath, png);
  }

  await writeIfChanged(path.join(dataDir, `${date}.json`), JSON.stringify(digest, null, 2));

  const existingLatest = await readJsonOrNull(path.join(dataDir, 'latest.json'));
  if (!existingLatest?.date || existingLatest.date <= date) {
    await writeIfChanged(path.join(dataDir, 'latest.json'), JSON.stringify(digest, null, 2));
  } else {
    console.log(`latest.json kept at ${existingLatest.date} (newer than ${date})`);
  }

  // Archive manifest: every per-day JSON present in data/.
  const dates = (await readdir(dataDir))
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .map((name) => name.replace('.json', ''))
    .sort();
  await writeIfChanged(path.join(dataDir, 'manifest.json'), JSON.stringify({ dates }, null, 2));

  if (!args.out && !args.fixtures) {
    const indexPath = path.join(SITE_DIR, 'index.html');
    const html = await readFile(indexPath, 'utf8');
    await writeFile(
      indexPath,
      injectOgTags(html, {
        title: narration.headline,
        description: narration.summary,
        image: `${siteUrl}data/og/${date}.png`,
        url: siteUrl,
      }),
    );
  }

  console.log(
    `Done: ${digest.matches.length} matches, ${digest.groups.length} groups, ${digest.tonight.length} tonight`,
  );

  await setOutput('published', 'true');
  await setOutput('date', date);
  await setOutput('headline', narration.headline);
  await setOutput('match_count', String(digest.matches.length));
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

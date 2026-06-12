/**
 * Daily digest orchestrator.
 *
 * Usage:
 *   node pipeline/run.js                         # live run for today (EEST)
 *   node pipeline/run.js --date 2026-06-12       # live run for a given date
 *   node pipeline/run.js --fixtures test/fixtures --date 2026-06-12
 *     # offline run: reads matches.json / standings.json / narration.json
 *     # from the fixtures dir instead of calling the APIs
 *
 * On any failure the existing site/data/latest.json is left untouched and the
 * process exits non-zero, so the workflow skips commit + deploy.
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchDigestData,
  selectDigestMatches,
  parseMatch,
  parseFixture,
  parseStandings,
  bucharestToday,
  kickoffEEST,
} from './fetch.js';
import { classifyStandings } from './standings.js';
import { narrate } from './narrate.js';
import { renderOgImage } from './og-image.js';
import { buildTeaser } from './teaser.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE_DIR = path.join(ROOT, 'site');
const DATA_DIR = path.join(SITE_DIR, 'data');

function parseArgs(argv) {
  const args = { date: null, fixtures: null };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--date') args.date = argv[++i];
    else if (argv[i] === '--fixtures') args.fixtures = argv[++i];
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
  const token = process.env.FOOTBALL_DATA_TOKEN;
  if (!token) throw new Error('FOOTBALL_DATA_TOKEN is not set');
  return fetchDigestData({ digestDate: date, token });
}

async function getNarration(facts, { fixtures, recentProse }) {
  if (fixtures) {
    const cannedPath = path.join(fixtures, 'narration.json');
    if (existsSync(cannedPath)) return readJson(cannedPath);
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  return narrate(facts, {
    apiKey,
    model: process.env.GEMINI_MODEL || undefined,
    recentProse,
  });
}

/**
 * Collects the prose (headline, summary, pills, tonight reasons) from the most
 * recent per-day digests so narration can be told not to recycle the same jokes
 * and metaphors. The model has no memory across daily runs on its own.
 */
async function recentProseBefore(date, days = 3) {
  const files = (await readdir(DATA_DIR))
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .map((name) => name.replace('.json', ''))
    .filter((d) => d < date)
    .sort()
    .slice(-days);

  const prose = [];
  for (const d of files) {
    const digest = await readJson(path.join(DATA_DIR, `${d}.json`));
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
  await loadDotEnv();

  const date = args.date ?? bucharestToday();
  const siteUrl = process.env.SITE_URL ?? 'https://mcandea04.github.io/mondial/';

  console.log(`Building digest for ${date}${args.fixtures ? ' (fixtures mode)' : ''}`);

  const facts = await gatherFacts({ date, fixtures: args.fixtures });
  const standings = classifyStandings(facts.standings);

  // Only groups that played last night get a snapshot on the page.
  const groupsThatPlayed = new Set(facts.finished.map((m) => m.group).filter(Boolean));

  const recentProse = args.fixtures ? [] : await recentProseBefore(date);

  const narration = await getNarration(
    { date, finished: facts.finished, tonight: facts.tonight, standings },
    { fixtures: args.fixtures, recentProse },
  );

  const narrationByMatch = new Map(narration.matches.map((m) => [m.id, m]));
  const narrationByFixture = new Map(narration.tonight.map((m) => [m.id, m]));

  const digest = {
    date,
    headline: narration.headline,
    summary: narration.summary,
    matches: facts.finished.map((m) => ({
      ...m,
      pill: narrationByMatch.get(m.id)?.pill ?? '',
      drama: narrationByMatch.get(m.id)?.drama ?? 1,
    })),
    groups: standings.filter((g) => groupsThatPlayed.has(g.name)),
    tonight: facts.tonight.map((m) => ({
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

  const png = await renderOgImage({
    date,
    headline: narration.headline,
    matches: digest.matches,
  });

  await mkdir(path.join(DATA_DIR, 'og'), { recursive: true });
  await writeFile(path.join(DATA_DIR, `${date}.json`), JSON.stringify(digest, null, 2));
  await writeFile(path.join(DATA_DIR, 'latest.json'), JSON.stringify(digest, null, 2));
  await writeFile(path.join(DATA_DIR, 'og', `${date}.png`), png);

  // Archive manifest: every per-day JSON present in data/.
  const dates = (await readdir(DATA_DIR))
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .map((name) => name.replace('.json', ''))
    .sort();
  await writeFile(path.join(DATA_DIR, 'manifest.json'), JSON.stringify({ dates }, null, 2));

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

  console.log(
    `Done: ${digest.matches.length} matches, ${digest.groups.length} groups, ${digest.tonight.length} tonight`,
  );
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

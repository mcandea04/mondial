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
 *   node pipeline/run.js --re-narrate           # force fresh narration even when
 *     # the stored digest's facts are unchanged (overrides the freeze)
 *   node pipeline/run.js --steer "<text>"       # append a one-shot steering note
 *     # to the narration prompt for this run only
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
  activeDigestDate,
  kickoffEEST,
} from './espn.js';
import { classifyStandings } from './standings.js';
import { narrate, narrateEn } from './narrate.js';
import { callClaude } from './claude-engine.js';
import { callGeminiNarration, callGeminiNarrationEn, callGeminiText } from './gemini-engine.js';
import { polishedNarration } from './narration-polish.js';
import {
  SYSTEM_PROMPT, SYSTEM_PROMPT_EN, buildUserMessage,
  CRITIQUE_SYSTEM_PROMPT_EN, buildRewriteSystemPromptEn,
  localizeProse, factsWithEnglishVerdicts, englishVerdict,
} from './narration-core.js';
import { fetchRecaps, parseHighlightFeed, recapsFor } from './highlights.js';
import { renderOgImage } from './og-image.js';
import { buildTeaser, buildTeaserEn } from './teaser.js';
import { factsHash } from './facts-hash.js';
import { reuseNarration } from './prose-reuse.js';
import { loadGold } from './gold.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE_DIR = path.join(ROOT, 'site');
const DATA_DIR = path.join(SITE_DIR, 'data');
const GOLD_PATH = path.join(ROOT, 'pipeline', 'gold.json');

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

/**
 * Picks the highlight URL for one match, preferring a freshly fetched link and
 * falling back to the stored link, then null. So a stored link is never
 * overwritten by null when a FIFA feed outage soft-fails to an empty map.
 *
 * Relies on recapByMatch holding only truthy URL strings (a missing reel is an
 * absent key, not a stored null) — a falsy value would defeat monotonicity.
 */
export function mergeHighlight(matchId, recapByMatch, existingHighlightById) {
  return recapByMatch.get(matchId) ?? existingHighlightById.get(matchId) ?? null;
}

/** True when a parsed match carries no ESPN-sourced detail at all. */
function hasNoEnrichment(match) {
  return (match.scorers?.length ?? 0) === 0
    && (match.events?.length ?? 0) === 0
    && match.stats == null;
}

/**
 * Monotonic enrichment: a finished match that ESPN once enriched is never
 * downgraded to bare facts by a later poll where the ESPN summary failed. When
 * the fresh parse has no scorers, events, or stats but a stored digest already
 * carried them for this id, the stored detail is restored. Mirrors
 * `mergeHighlight`: a transient outage can't strip detail (or flip the hash and
 * re-narrate) off a match that already had it. The score itself comes from
 * ESPN and is always fresh, so it is left untouched. Stats are handled
 * separately by `mergeStats` (write-once freeze), not restored here.
 */
export function mergeEnrichment(match, existingByMatch) {
  const prior = existingByMatch.get(match.id);
  if (!prior || !hasNoEnrichment(match)) return match;
  if (hasNoEnrichment(prior)) return match;
  return {
    ...match,
    scorers: prior.scorers ?? match.scorers,
    events: prior.events ?? match.events,
  };
}

/**
 * Write-once stats freeze: a match's stats block locks to the first non-null
 * published value. Later possession refinements (post-whistle ESPN refinement)
 * are discarded so a cosmetic stat wobble never byte-changes the digest. A match
 * first published with null stats stays open for one fill, then locks.
 */
export function mergeStats(fresh, prior) {
  return prior != null ? prior : fresh;
}

/** Reads a (possibly legacy-string) narrator field for one language. */
function localizeNarrator(narrator, lang) {
  if (narrator == null) return null;
  if (typeof narrator === 'string') return lang === 'ro' ? narrator : null;
  return narrator[lang] ?? null;
}

/**
 * Rebuilds EN narration from a stored bilingual digest, mirroring reuseNarration
 * but reading the .en side of each prose field. Returns null when any required
 * EN field is missing (so a RO-only stored day reuses RO and leaves EN absent).
 */
export function reuseNarrationEn(stored, facts) {
  const enOrNull = (field) => (field && typeof field === 'object' && field.en != null ? field.en : null);
  const headline = enOrNull(stored.headline);
  const summary = enOrNull(stored.summary);
  if (!headline || !summary) return null;

  const storedMatches = new Map((stored.matches ?? []).map((m) => [m.id, m]));
  const matches = [];
  for (const m of facts.finished) {
    const s = storedMatches.get(m.id);
    const pill = enOrNull(s?.pill);
    if (!pill) return null;
    matches.push({ id: m.id, pill, drama: s.drama ?? 1 });
  }

  const tonightById = new Map();
  const tonightByTeams = new Map();
  for (const t of stored.tonight ?? []) {
    if (t.id != null) tonightById.set(t.id, t);
    tonightByTeams.set(`${t.home}|${t.away}`, t);
  }
  const tonight = [];
  for (const f of facts.tonight) {
    const s = tonightById.get(f.id) ?? tonightByTeams.get(`${f.home}|${f.away}`);
    const why = enOrNull(s?.why);
    const alarm = enOrNull(s?.alarm);
    if (!why || !alarm) return null;
    tonight.push({ id: f.id, alarm, why });
  }
  return { headline, summary, matches, tonight };
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
  if (!fixtures) return fetchDigestData({ digestDate: date });

  const { readFileSync, existsSync } = await import('node:fs');
  const fixturesDir = path.resolve(fixtures);
  const readFixture = (name) => JSON.parse(readFileSync(path.join(fixturesDir, name), 'utf8'));

  // Fixture fetchImpl: serves scoreboard.json, summary-<id>.json, espn-standings.json
  // from the dir. Each branch returns a body; unknown paths and missing summaries
  // yield {} so a finished match simply ships bare.
  const fixtureBody = (url) => {
    if (url.includes('/scoreboard?dates=')) {
      const dateStr = url.match(/dates=(\d+)/)[1];
      return { events: readFixture('scoreboard.json')[dateStr]?.events ?? [] };
    }
    if (url.includes('/summary?event=')) {
      const eventId = url.match(/event=(\w+)/)[1];
      const summaryName = `summary-${eventId}.json`;
      return existsSync(path.join(fixturesDir, summaryName)) ? readFixture(summaryName) : {};
    }
    if (url.includes('/standings')) return readFixture('espn-standings.json');
    return {};
  };
  const fixtureFetch = async (url) => ({ ok: true, async json() { return fixtureBody(url); } });

  return fetchDigestData({ digestDate: date, fetchImpl: fixtureFetch, delayMs: 0 });
}

/**
 * Gemini narration. Offline (--fixtures) it returns the canned narration.json
 * when present, so a fixtures run never touches the network; this also makes it
 * the offline stand-in when the Opus path falls back.
 */
function geminiNarration(facts, { fixtures, recentProse, steer, gold }) {
  if (fixtures) {
    const cannedPath = path.join(fixtures, 'narration.json');
    if (existsSync(cannedPath)) return readJson(cannedPath);
  }
  return narrate(facts, {
    apiKey: requireEnv('GEMINI_API_KEY'),
    model: process.env.GEMINI_MODEL || undefined,
    recentProse,
    steer,
    gold,
  });
}

/**
 * RO narration: current body of getNarration, extracted verbatim. Returns
 * { narration, narrator }. Logic is unchanged — this is a pure rename/extract.
 */
async function getRoNarration(facts, {
  fixtures, recentProse, steer, gold,
  claudeEngine, polishEngine, geminiDraftEngine, geminiCritiqueEngine,
}) {
  const mode = process.env.NARRATOR;

  // Gemini idiom-polish: draft -> critique -> rewrite, all on Gemini. Offline
  // (fixtures) there is no live polish, so fall through to the canned narration.
  //
  // No try/catch fallback here (unlike the Opus path, which degrades TO Gemini):
  // gemini-polish has no lower tier to fall to — the draft already rides the
  // primary->2.5-flash model ladder in narrate.js, so a draft failure means a
  // total Gemini outage that single-pass could not survive either. A polish-STAGE
  // failure is already swallowed inside polishedNarration (ships the draft,
  // polished=false -> 'gemini'). A draft failure propagates so the run exits
  // non-zero and the next 15-min --require-complete poll retries — same contract
  // as the plain single-pass gemini path.
  if (mode === 'gemini-polish' && !fixtures) {
    const model = process.env.GEMINI_MODEL || undefined;
    const userMessage = buildUserMessage(facts, recentProse, steer, gold);
    const { narration, polished } = await polishEngine({
      model, userMessage, draftEngine: geminiDraftEngine, critiqueEngine: geminiCritiqueEngine,
    });
    return { narration, narrator: polished ? 'gemini-polish' : 'gemini' };
  }

  if (mode !== 'opus' && mode !== 'opus-polish') {
    return { narration: await geminiNarration(facts, { fixtures, recentProse, steer, gold }), narrator: 'gemini' };
  }
  const model = process.env.CLAUDE_MODEL || 'opus';
  const userMessage = buildUserMessage(facts, recentProse, steer, gold);
  try {
    if (mode === 'opus-polish') {
      const { narration, polished } = await polishEngine({ model, userMessage, draftEngine: claudeEngine });
      return { narration, narrator: polished ? 'opus-polish' : 'opus' };
    }
    return { narration: await claudeEngine({ model, userMessage, systemPrompt: SYSTEM_PROMPT }), narrator: 'opus' };
  } catch (error) {
    const cause = error.auth ? 'auth failure' : 'bad output after retries';
    console.warn(`Opus narration failed (${cause}): ${error.message}. Falling back to Gemini.`);
    return { narration: await geminiNarration(facts, { fixtures, recentProse, steer, gold }), narrator: 'gemini-fallback' };
  }
}

/**
 * EN narration: mirrors getRoNarration engine selection but with EN prompts/schema
 * and the EN offline fixture. Best-effort — callers catch and yield null on failure.
 *
 * Fixture handling only applies to Gemini paths: the opus/opus-polish paths use the
 * injected claudeEngine directly (they have their own auth/retry logic and tests
 * expect the engine to be called even when fixtures is set).
 */
async function getEnNarration(facts, {
  fixtures, recentProse, steer, gold,
  claudeEngine, polishEngine, geminiDraftEngineEn, geminiCritiqueEngine,
}) {
  const mode = process.env.NARRATOR;

  const userMessage = buildUserMessage(facts, recentProse, steer, gold);

  if (mode === 'gemini-polish') {
    if (fixtures) {
      const cannedPath = path.join(fixtures, 'narration.en.json');
      if (!existsSync(cannedPath)) return null;
      return { narration: await readJson(cannedPath), narrator: 'gemini' };
    }
    const model = process.env.GEMINI_MODEL || undefined;
    const { narration, polished } = await polishEngine({
      model, userMessage,
      draftEngine: geminiDraftEngineEn, critiqueEngine: geminiCritiqueEngine,
      systemPrompt: SYSTEM_PROMPT_EN,
      critiquePrompt: CRITIQUE_SYSTEM_PROMPT_EN,
      buildRewritePrompt: buildRewriteSystemPromptEn,
    });
    return { narration, narrator: polished ? 'gemini-polish' : 'gemini' };
  }

  if (mode !== 'opus' && mode !== 'opus-polish') {
    if (fixtures) {
      const cannedPath = path.join(fixtures, 'narration.en.json');
      if (!existsSync(cannedPath)) return null;
      return { narration: await readJson(cannedPath), narrator: 'gemini' };
    }
    return {
      narration: await narrateEn(facts, {
        apiKey: requireEnv('GEMINI_API_KEY'),
        model: process.env.GEMINI_MODEL || undefined,
        recentProse, steer, gold,
      }),
      narrator: 'gemini',
    };
  }

  const model = process.env.CLAUDE_MODEL || 'opus';
  if (mode === 'opus-polish') {
    const { narration, polished } = await polishEngine({
      model, userMessage, draftEngine: claudeEngine,
      systemPrompt: SYSTEM_PROMPT_EN,
      critiquePrompt: CRITIQUE_SYSTEM_PROMPT_EN,
      buildRewritePrompt: buildRewriteSystemPromptEn,
    });
    return { narration, narrator: polished ? 'opus-polish' : 'opus' };
  }
  return { narration: await claudeEngine({ model, userMessage, systemPrompt: SYSTEM_PROMPT_EN }), narrator: 'opus' };
}

/**
 * Picks the narrator by the NARRATOR env var and returns
 * { narration, narrator, en }, where:
 * - narration/narrator: the Romanian prose (identical to prior behavior).
 * - en: { narration, narrator } for the English prose, or null when EN fails.
 *
 * EN is best-effort: any failure logs a warning and yields en: null so the
 * digest always ships in Romanian. Values:
 *   unset / "gemini"  — Gemini single-pass.
 *   "gemini-polish"   — Gemini draft -> idiom critique -> rewrite. When the
 *                       polish stage fails the validated draft ships, marked
 *                       "gemini".
 *   "opus"            — single-pass headless Opus.
 *   "opus-polish"     — Opus draft -> idiom critique -> rewrite. When the polish
 *                       stage fails the validated draft ships, marked "opus".
 *
 * Any Opus *draft* failure — expired/invalid OAuth token, or bad output after
 * its retries — logs a warning and falls back to Gemini, marked
 * "gemini-fallback". The digest must never miss a morning over a
 * narration-engine problem. Engines are injectable for testing.
 */
export async function getNarration(facts, {
  fixtures, recentProse, steer, gold = [],
  claudeEngine = callClaude,
  polishEngine = polishedNarration,
  geminiDraftEngine = callGeminiNarration,
  geminiCritiqueEngine = callGeminiText,
  geminiDraftEngineEn = callGeminiNarrationEn,
} = {}) {
  const ro = await getRoNarration(facts, {
    fixtures, recentProse, steer, gold,
    claudeEngine, polishEngine, geminiDraftEngine, geminiCritiqueEngine,
  });
  // The English pass narrates the same facts plus the Romanian watch verdict per
  // fixture, so the two languages agree on watch/skip and differ only in wording.
  const enFacts = factsWithEnglishVerdicts(facts, ro.narration);
  const en = await getEnNarration(enFacts, {
    fixtures, recentProse, steer, gold,
    claudeEngine, polishEngine, geminiDraftEngineEn, geminiCritiqueEngine,
  }).catch((error) => {
    console.warn(`English narration failed (${error.message}). Shipping Romanian only.`);
    return null;
  });
  return { ...ro, en };
}

/**
 * Maps finished-match ids to FIFA highlight URLs. Offline (--fixtures) it reads
 * highlights.json from the dir when present and skips the network otherwise.
 * Always returns a Map; never throws, so a feed outage cannot fail the digest.
 */
async function getRecaps(finished, { fixtures }) {
  if (fixtures) {
    const cannedPath = path.join(fixtures, 'highlights.json');
    if (!existsSync(cannedPath)) return new Map();
    return recapsFor(finished, parseHighlightFeed(await readJson(cannedPath)));
  }
  return fetchRecaps({ matches: finished });
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
    prose.push(localizeProse(digest.headline, 'ro'), localizeProse(digest.summary, 'ro'));
    for (const m of digest.matches ?? []) prose.push(localizeProse(m.pill, 'ro'));
    for (const t of digest.tonight ?? []) prose.push(localizeProse(t.why, 'ro'));
  }
  return prose.filter(Boolean);
}

/** Drops avoid-list lines that are now blessed gold, so a promoted line is taught, not forbidden. */
export function withoutGold(recentProse, gold) {
  if (!gold.length) return recentProse;
  const goldTexts = new Set(gold.map((g) => g.text));
  return recentProse.filter((line) => !goldTexts.has(line));
}

/** Loads the gold archive, degrading to no-gold (never failing the run) on a corrupt file. */
async function loadGoldSafe() {
  try {
    return await loadGold(GOLD_PATH);
  } catch (error) {
    console.warn(`gold.json unreadable (${error.message}); proceeding without gold.`);
    return [];
  }
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
    const matches = await fetchNightMatches({ digestDate: date });
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

  // Read the stored digest first: it both supplies prior enrichment (so a failed
  // ESPN poll can't strip detail off an already-rich match) and powers the freeze.
  const existing = await readJsonOrNull(path.join(dataDir, `${date}.json`));
  const existingByMatch = new Map((existing?.matches ?? []).map((m) => [m.id, m]));
  facts.finished = facts.finished.map((m) => {
    const enriched = mergeEnrichment(m, existingByMatch);
    const prior = existingByMatch.get(m.id);
    return { ...enriched, stats: mergeStats(enriched.stats, prior?.stats ?? null) };
  });

  // Only groups that played last night get a snapshot on the page.
  const groupsThatPlayed = new Set(facts.finished.map((m) => m.group).filter(Boolean));

  const factsForNarration = { date, finished: facts.finished, tonight: facts.tonight, standings };
  // Hashed AFTER mergeEnrichment so a transient outage doesn't flip the hash.
  const hash = factsHash(factsForNarration);

  // Freeze: when the stored digest was built from the same facts, reuse its
  // prose instead of regenerating. A stored digest without factsHash predates
  // this mechanism and is trusted as-is (the hash gets stamped on rewrite).

  // `narration` (RO) and `enNarration` (EN | null). Reuse path supplies both
  // from the stored digest; fresh path from getNarration.
  let narration = null;       // RO narration object (flat strings) — feeds OG/teaser/email
  let enNarration = null;     // EN narration object | null
  let narratorRo = null;
  let narratorEn = null;
  let reused = false;

  if (!args.reNarrate && existing && (!existing.factsHash || existing.factsHash === hash)) {
    const reusedRo = reuseNarration(existing, facts);
    if (reusedRo) {
      // reuseNarration returns prose fields as-stored; localize to flat RO strings
      // so narration feeds OG/teaser/email as plain text.
      narration = {
        headline: localizeProse(reusedRo.headline, 'ro'),
        summary: localizeProse(reusedRo.summary, 'ro'),
        matches: reusedRo.matches.map((m) => ({
          id: m.id,
          pill: localizeProse(m.pill, 'ro'),
          drama: m.drama,
        })),
        tonight: reusedRo.tonight.map((t) => ({
          id: t.id,
          alarm: localizeProse(t.alarm, 'ro'),
          why: localizeProse(t.why, 'ro'),
        })),
      };
      narratorRo = localizeNarrator(existing.narrator, 'ro') ?? 'gemini';
      // EN reuse: only if the stored digest already had EN prose for all needed ids.
      enNarration = reuseNarrationEn(existing, facts);   // null if any en missing
      narratorEn = enNarration ? (localizeNarrator(existing.narrator, 'en') ?? null) : null;
      reused = true;
    }
  }

  if (reused) {
    console.log('facts unchanged, prose reused');
  } else {
    const gold = await loadGoldSafe();
    const recentProse = args.fixtures ? [] : withoutGold(await recentProseBefore(dataDir, date), gold);
    const result = await getNarration(factsForNarration, {
      fixtures: args.fixtures, recentProse, steer: args.steer, gold,
    });
    narration = result.narration;
    narratorRo = result.narrator;
    enNarration = result.en?.narration ?? null;
    narratorEn = result.en?.narrator ?? null;
  }

  const recapByMatch = await getRecaps(facts.finished, { fixtures: args.fixtures });

  const narrationByMatch = new Map(narration.matches.map((m) => [m.id, m]));
  const narrationByFixture = new Map(narration.tonight.map((m) => [m.id, m]));
  const enByMatch = new Map((enNarration?.matches ?? []).map((m) => [m.id, m]));
  const enByFixture = new Map((enNarration?.tonight ?? []).map((m) => [m.id, m]));

  // Builds {ro, en} dropping the en key when the EN value is absent.
  const bilingual = (ro, en) => (en == null ? { ro } : { ro, en });

  // Monotonic merge: a highlight link, once stored, is never overwritten by null
  // when a later FIFA feed outage yields no link for that match.
  const existingHighlightById = new Map(
    (existing?.matches ?? []).map((m) => [m.id, m.highlight]),
  );

  const digest = {
    date,
    factsHash: hash,
    narrator: bilingual(narratorRo, narratorEn),
    headline: bilingual(narration.headline, enNarration?.headline),
    summary: bilingual(narration.summary, enNarration?.summary),
    matches: facts.finished.map((m) => ({
      ...m,
      pill: bilingual(narrationByMatch.get(m.id)?.pill ?? '', enByMatch.get(m.id)?.pill),
      drama: narrationByMatch.get(m.id)?.drama ?? 1,
      highlight: mergeHighlight(m.id, recapByMatch, existingHighlightById),
    })),
    groups: standings.filter((g) => groupsThatPlayed.has(g.name)),
    tonight: facts.tonight.map((m) => ({
      id: m.id,
      home: m.home,
      away: m.away,
      homeCode: m.homeCode ?? null,
      awayCode: m.awayCode ?? null,
      kickoffEEST: m.kickoffEEST ?? kickoffEEST(m.utcDate),
      // The watch verdict is canonical (Romanian); the English alarm is its
      // mapped form, never the English model's own call — so the two never
      // disagree. Only `why` wording differs per language.
      alarm: bilingual(
        narrationByFixture.get(m.id)?.alarm ?? 'citești dimineața',
        enByFixture.get(m.id)?.why == null ? undefined : englishVerdict(narrationByFixture.get(m.id)?.alarm),
      ),
      why: bilingual(narrationByFixture.get(m.id)?.why ?? '', enByFixture.get(m.id)?.why),
    })),
    teaser: bilingual(
      buildTeaser({ headline: narration.headline, matchCount: facts.finished.length, siteUrl }),
      enNarration ? buildTeaserEn({ headline: enNarration.headline, matchCount: facts.finished.length, siteUrl }) : undefined,
    ),
  };

  const ogPath = path.join(dataDir, 'og', `${date}.png`);

  // Publish-only-on-change gate (under --require-complete): when the rebuilt
  // digest is byte-identical to the stored one and the OG image already exists,
  // this run has nothing new to deploy. This is the "keep running until every
  // highlight link arrives, then stop" signal from issue #9. The byte compare
  // spans every published field, so a late scorer/card/standings correction
  // (which factsHash omits) still deploys. Comparing against `existing` (the
  // prior run's stored digest, read before any write) lets a post-crash repair
  // run still rebuild latest.json / manifest.json / the OG image when one is
  // missing or stale, since the gate trips only after the OG image exists too.
  if (args.requireComplete) {
    const storedBytes = existing ? JSON.stringify(existing, null, 2) : null;
    const newBytes = JSON.stringify(digest, null, 2);
    if (storedBytes === newBytes && existsSync(ogPath)) {
      console.log('nothing changed; already published');
      await setOutput('published', 'false');
      return;
    }
  }

  await mkdir(path.join(dataDir, 'og'), { recursive: true });

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

  // Archive manifest: every per-day JSON present in data/, plus the per-day
  // recap count so the archive can flag mornings that have video recaps.
  const dates = (await readdir(dataDir))
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .map((name) => name.replace('.json', ''))
    .sort();
  const recaps = {};
  for (const d of dates) {
    const day = await readJson(path.join(dataDir, `${d}.json`));
    const count = (day.matches ?? []).filter((m) => m.highlight).length;
    if (count > 0) recaps[d] = count;
  }
  await writeIfChanged(path.join(dataDir, 'manifest.json'), JSON.stringify({ dates, recaps }, null, 2));

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
  await setOutput('headline', narration.headline);   // flat RO string — correct
  await setOutput('match_count', String(digest.matches.length));
  await setOutput('narrator', narratorRo);            // flat RO string, not the {ro,en} object
  // Email fires only when fresh prose was generated (first publish, facts change,
  // or --re-narrate), never when the stored prose was reused for a highlight or
  // stats-only update. `reused` is false in exactly those fresh-narrate cases.
  await setOutput('narrationChanged', String(!reused));
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

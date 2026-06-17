/**
 * One-time migration: adds an English (`en`) side to every committed day's prose
 * fields, leaving the Romanian prose (and all facts) untouched. Idempotent — a
 * day that already has headline.en is skipped. EN tonight reasoning runs with
 * FIFA ranks absent (stored days never carried them); the EN prompt's null-rank
 * branch handles that, so historical EN tonight prose is slightly weaker than a
 * live run. Accepted: past "tonight" sections are ephemeral.
 *
 * Run AFTER the bilingual render.js/pipeline code is deployed (so the live site
 * tolerates the new shape), then deploy the data via a manual deploy.yml dispatch.
 *
 * Usage: node pipeline/backfill-en.js                 # all days in site/data
 *        node pipeline/backfill-en.js --date 2026-06-12
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { narrateEn } from './narrate.js';
import { buildTeaserEn } from './teaser.js';
import { englishVerdict } from './narration-core.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA_DIR = path.join(ROOT, 'site', 'data');

/** A day needs backfill unless its headline is already a {ro,en} object with en. */
export function needsBackfill(digest) {
  return !(digest.headline && typeof digest.headline === 'object' && digest.headline.en != null);
}

/** {ro,en} from a (possibly already-object) RO field plus an EN string. */
function merge(field, en) {
  const ro = typeof field === 'object' && field !== null ? field.ro : field;
  return en == null ? { ro } : { ro, en };
}

/** The Romanian side of a prose field that may be a plain string or {ro,en}. */
function roOf(field) {
  return typeof field === 'object' && field !== null ? field.ro : field;
}

/**
 * Reconstructs the narration-facts object from a stored day. Ranks are absent in
 * stored days, so they are reconstructed as null (the prompt must not invent a
 * hierarchy). Standings context is the classified `groups` (raw standings were
 * not stored).
 */
export function reconstructFacts(digest) {
  return {
    date: digest.date,
    finished: (digest.matches ?? []).map((m) => ({
      id: m.id, home: m.home, away: m.away, homeCode: m.homeCode, awayCode: m.awayCode,
      group: m.group, score: m.score, scorers: m.scorers ?? [], events: m.events ?? [],
      stats: m.stats ?? null, decidedOnPenalties: m.decidedOnPenalties ?? false,
    })),
    tonight: (digest.tonight ?? []).map((t) => ({
      id: t.id, home: t.home, away: t.away, homeCode: t.homeCode, awayCode: t.awayCode,
      kickoffEEST: t.kickoffEEST, homeRank: null, awayRank: null,
      // The Romanian alarm is the canonical verdict; hand it to the English pass
      // so EN justifies the same watch/skip call rather than re-deciding it.
      verdict: englishVerdict(roOf(t.alarm)),
    })),
    standings: digest.groups ?? [],
  };
}

/** Merges an EN narration into a stored day's prose; RO and facts untouched. */
export function backfillDay(digest, enNarration) {
  const enMatch = new Map((enNarration.matches ?? []).map((m) => [m.id, m]));
  const enTonight = new Map((enNarration.tonight ?? []).map((t) => [t.id, t]));
  const matchCount = (digest.matches ?? []).length;
  const teaserEn = buildTeaserEn({ headline: enNarration.headline, matchCount, siteUrl: 'https://mcandea04.github.io/mondial/' });

  return {
    ...digest,
    narrator: merge(digest.narrator, 'gemini'),
    headline: merge(digest.headline, enNarration.headline),
    summary: merge(digest.summary, enNarration.summary),
    matches: (digest.matches ?? []).map((m) => ({ ...m, pill: merge(m.pill, enMatch.get(m.id)?.pill) })),
    tonight: (digest.tonight ?? []).map((t) => ({
      ...t,
      // alarm.en is the canonical Romanian verdict mapped to English, never the
      // English model's own call, so the two languages never disagree.
      alarm: merge(t.alarm, englishVerdict(roOf(t.alarm))),
      why: merge(t.why, enTonight.get(t.id)?.why),
    })),
    teaser: merge(digest.teaser, teaserEn),
  };
}

async function main() {
  const dateArg = process.argv.includes('--date') ? process.argv[process.argv.indexOf('--date') + 1] : null;
  // --force regenerates the English side even for days already bilingual (use
  // after an English-prompt or verdict-logic change).
  const force = process.argv.includes('--force');
  const files = (await readdir(DATA_DIR))
    .filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
    .filter((n) => !dateArg || n === `${dateArg}.json`);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  for (const file of files) {
    const full = path.join(DATA_DIR, file);
    const digest = JSON.parse(await readFile(full, 'utf8'));
    if (!force && !needsBackfill(digest)) { console.log(`skip ${file} (already bilingual)`); continue; }
    const facts = reconstructFacts(digest);
    const enNarration = await narrateEn(facts, { apiKey });
    const merged = backfillDay(digest, enNarration);
    await writeFile(full, JSON.stringify(merged, null, 2));
    console.log(`backfilled ${file}`);
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main().catch((error) => { console.error(error); process.exit(1); });
}

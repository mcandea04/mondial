/**
 * The gold archive: a small, hand-blessed set of narration lines the owner
 * loved, fed back into the prompt as few-shot taste examples (the positive
 * mirror of the avoid-list). This module owns reading, parsing, and appending
 * those lines; it has no model or network dependency.
 *
 * A line is { field, text } where field is one of the four schema text fields.
 * A per-field FIFO cap bounds the prompt; it is applied on both append and load
 * so a hand-edited or seed-written file that overshoots is still bounded.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const GOLD_FIELDS = new Set(['headline', 'summary', 'pill', 'tonight']);
export const DEFAULT_CAP = 12;

/** Keeps only the last `cap` entries of each field, preserving overall order. */
function capPerField(entries, cap) {
  const counts = {};
  const kept = [];
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const { field } = entries[i];
    counts[field] = (counts[field] ?? 0) + 1;
    if (counts[field] <= cap) kept.push(entries[i]);
  }
  return kept.reverse();
}

/**
 * Parses a gold-promotion issue body into [{field, text}]. One entry per
 * non-blank line. A line starting with exactly `headline:`/`summary:`/`pill:`/
 * `tonight:` (case-insensitive) takes that field; anything else — including a
 * line that merely contains a colon, like a clock time — is kept whole as a
 * `pill`. HTML-comment placeholders are stripped. A valid prefix with empty
 * text is skipped.
 */
export function parseGoldIssue(body) {
  const cleaned = (body ?? '').replace(/<!--[\s\S]*?-->/g, '');
  const entries = [];
  for (const raw of cleaned.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/^([a-zA-Z]+):\s*(.*)$/);
    const field = match && match[1].toLowerCase();
    if (match && GOLD_FIELDS.has(field)) {
      const text = match[2].trim();
      if (text) entries.push({ field, text });
    } else {
      entries.push({ field: 'pill', text: line });
    }
  }
  return entries;
}

/** Appends new entries, dropping exact {field,text} duplicates, then caps per field. */
export function appendGold(existing, entries, cap = DEFAULT_CAP) {
  const seen = new Set(existing.map((e) => `${e.field} ${e.text}`));
  const merged = [...existing];
  for (const e of entries) {
    const key = `${e.field} ${e.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(e);
  }
  return capPerField(merged, cap);
}

/** Validates one parsed entry; throws on a corrupt shape so a bad file is never trusted. */
function assertEntry(e) {
  if (!e || typeof e.text !== 'string' || !GOLD_FIELDS.has(e.field)) {
    throw new Error(`gold.json: invalid entry ${JSON.stringify(e)}`);
  }
}

/**
 * Reads the gold archive, capped per field. Missing file → []. Malformed JSON
 * or a corrupt entry THROWS — the caller decides whether to proceed gold-less
 * (narrator path) or abort (append path); we never silently return [] on a
 * corrupt file, which would let an append overwrite and erase the archive.
 */
export async function loadGold(filePath, cap = DEFAULT_CAP) {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch {
    return [];
  }
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('gold.json: expected a JSON array');
  parsed.forEach(assertEntry);
  return capPerField(parsed, cap);
}

/** Writes the archive as pretty JSON with a trailing newline. */
export async function writeGold(filePath, entries) {
  await writeFile(filePath, `${JSON.stringify(entries, null, 2)}\n`);
}

/**
 * Appends a promotion issue body to the gold file. Loads (throwing on a corrupt
 * file so it is never clobbered), parses, dedup-appends with the cap, writes.
 */
export async function addFromIssue(filePath, body, cap = DEFAULT_CAP) {
  const existing = await loadGold(filePath, cap);
  const merged = appendGold(existing, parseGoldIssue(body), cap);
  await writeGold(filePath, merged);
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun && process.argv[2] === 'add-from-issue') {
  const file = path.join(fileURLToPath(new URL('.', import.meta.url)), 'gold.json');
  const body = process.env.GOLD_ISSUE_BODY ?? '';
  addFromIssue(file, body).then(
    () => console.log('gold.json updated'),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}

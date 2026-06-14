/**
 * Stable identity for the prose a digest narrates. Two runs whose narrated
 * facts match produce the same hash — regardless of key order, array order, or
 * volatile fields the prose never mentions (full standings, scorer lists, event
 * feeds, finished-match kickoff times). This lets the pipeline tell "facts
 * unchanged, reuse prose" from "facts changed, re-narrate" without unfreezing a
 * published day every time an unrelated group's table shifts.
 */

import { createHash } from 'node:crypto';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = canonicalize(value[key]);
    return sorted;
  }
  return value;
}

const byId = (a, b) => (a.id ?? 0) - (b.id ?? 0);

/**
 * Total order for a match's events, so the order ESPN happens to return goals in
 * on a given poll never flips the hash. `localeCompare` with `numeric` keeps
 * "90+2" after "9"; minute+name+team+scorer-detail break ties so two distinct
 * events at the same minute always sort the same way. Operates on parseMatch
 * output, where each entry carries a top-level `name`.
 */
const byEvent = (a, b) =>
  String(a.minute ?? '').localeCompare(String(b.minute ?? ''), undefined, { numeric: true }) ||
  String(a.name ?? '').localeCompare(String(b.name ?? '')) ||
  String(a.team ?? '').localeCompare(String(b.team ?? '')) ||
  String(a.assist ?? a.reason ?? '').localeCompare(String(b.assist ?? b.reason ?? ''));

const sorted = (arr) => (Array.isArray(arr) ? [...arr].sort(byEvent) : arr);

/**
 * The narrated-facts projection: only what the headline/summary/pills depend on.
 * Covers the discrete drama facts — scorers (with manner/assist) and dismissals
 * (with reason) — so a late ESPN backfill of one re-narrates once. Deliberately
 * EXCLUDES `stats`: possession/shots are revised repeatedly post-whistle and are
 * flavor, not drama, so hashing them would churn the narrator (and risk an
 * engine swap) for no narrative gain; stats still ride into the published JSON.
 */
function project({ date, finished, tonight }) {
  return {
    date,
    finished: [...finished]
      .sort(byId)
      .map((m) => ({ id: m.id, score: m.score, scorers: sorted(m.scorers), events: sorted(m.events) })),
    tonight: [...tonight]
      .sort(byId)
      .map((m) => ({ id: m.id, home: m.home, away: m.away, kickoffEEST: m.kickoffEEST })),
  };
}

export function factsHash(facts) {
  const canonical = canonicalize(project(facts));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

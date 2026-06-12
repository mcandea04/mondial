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

/** The narrated-facts projection: only what the headline/summary/pills depend on. */
function project({ date, finished, tonight }) {
  return {
    date,
    finished: [...finished]
      .sort(byId)
      .map((m) => ({ id: m.id, score: m.score })),
    tonight: [...tonight]
      .sort(byId)
      .map((m) => ({ id: m.id, home: m.home, away: m.away, kickoffEEST: m.kickoffEEST })),
  };
}

export function factsHash(facts) {
  const canonical = canonicalize(project(facts));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

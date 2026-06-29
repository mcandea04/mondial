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
 * Stable hash-key for a slimmed scorer/event element: its canonical JSON. Sorting
 * by this gives a total order that depends only on the fields kept in the hash, so
 * the order ESPN happens to return goals in on a given poll never flips the hash.
 * Default lexicographic compare is enough — this is a hash input, not a display
 * order, so numeric-aware minute ordering is unnecessary.
 */
const keyOf = (element) => JSON.stringify(canonicalize(element));

/**
 * Slim each element to the whitelisted core-drama fields, then sort the slimmed
 * elements by their canonical JSON. `pick` maps to fresh objects so the source
 * scorer/event objects (which still ride into the published JSON) are never
 * mutated. Duplicates are preserved — never deduped — so two distinct goals that
 * slim to the same shape both stay and array length still distinguishes them.
 */
const slimSorted = (arr, pick) =>
  Array.isArray(arr) ? arr.map(pick).sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0)) : arr;

const slimScorer = (s) => ({
  name: s.name,
  minute: s.minute,
  team: s.team,
  penalty: s.penalty,
  ownGoal: s.ownGoal,
});

const slimEvent = (e) => ({ name: e.name, minute: e.minute, team: e.team });

/**
 * The narrated-facts projection: only what the headline/summary/pills depend on.
 * Covers the core drama facts — score, scorer (name/minute/team/penalty/ownGoal)
 * and dismissals (name/minute/team) — so a real fact change re-narrates once.
 * Deliberately EXCLUDES soft fields the prose can lose without being worse
 * (`assist`, `bodyPart`, `placement`, card `reason`) and `stats`: all of these
 * are revised post-whistle and would churn the narrator for no narrative gain.
 * They still ride into the published JSON; only the hash input is narrowed.
 */
function project({ date, finished, tonight }) {
  return {
    date,
    finished: [...finished]
      .sort(byId)
      .map((m) => ({
        id: m.id,
        stage: m.stage ?? null,
        winnerAdvancesTo: m.winnerAdvancesTo ?? null,
        score: m.score,
        winner: m.winner ?? null,
        loser: m.loser ?? null,
        scorers: slimSorted(m.scorers, slimScorer),
        events: slimSorted(m.events, slimEvent),
      })),
    tonight: [...tonight]
      .sort(byId)
      .map((m) => ({
        id: m.id,
        home: m.home,
        away: m.away,
        stage: m.stage ?? null,
        winnerAdvancesTo: m.winnerAdvancesTo ?? null,
        kickoffEEST: m.kickoffEEST,
      })),
  };
}

export function factsHash(facts) {
  const canonical = canonicalize(project(facts));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

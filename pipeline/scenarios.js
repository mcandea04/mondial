/**
 * Deterministic qualification scenario engine — Phase 2.
 *
 * For each team still alive in its group, enumerates the remaining result
 * permutations and emits a plain-text Romanian scenario fact.
 *
 * Scope: top-2 (direct qualification) only. Best-thirds advancement is not
 * computed — teams whose only path is via best third receive a hedged note.
 *
 * Tiebreaker chain (FIFA 2026):
 *   1. Total points
 *   2. H2H points among tied teams
 *   3. H2H GD / goals / overall GD / fair-play / lots → UNCERTAIN
 *
 * When a scenario's top-2 determination requires step 3, we emit
 * "scenariu incert (departajare specială)" rather than guessing.
 */

import { buildH2H, h2hResult } from './standings.js';

const MATCHES_PER_TEAM = 3;

// ── Round-robin helpers ───────────────────────────────────────────────────────

/** All C(4,2) = 6 unordered pairings for a 4-team group. */
function allPairings(teams) {
  const pairs = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      pairs.push([teams[i], teams[j]]);
    }
  }
  return pairs;
}

/**
 * Remaining fixtures = all 6 pairings minus those already played.
 * Returns [[home, away], ...] — home/away order is arbitrary (doesn't affect math).
 */
function deriveRemaining(teams, allGroupMatches) {
  const played = new Set();
  for (const m of allGroupMatches) {
    const key = [m.home, m.away].sort().join('|');
    played.add(key);
  }
  return allPairings([...teams]).filter(([a, b]) => !played.has([a, b].sort().join('|')));
}

/** Generates all 3^n outcome arrays. Each entry: 'home_win' | 'draw' | 'away_win'. */
function enumerateOutcomes(n) {
  const OUTCOMES = ['home_win', 'draw', 'away_win'];
  let result = [[]];
  for (let i = 0; i < n; i++) {
    const next = [];
    for (const perm of result) {
      for (const o of OUTCOMES) next.push([...perm, o]);
    }
    result = next;
  }
  return result;
}

// ── Simulation ────────────────────────────────────────────────────────────────

/**
 * H2H points earned by `team` in matches exclusively against `tiedTeams`.
 * Uses the merged H2H map (real + simulated).
 */
function h2hPtsAmong(team, tiedTeams, h2h) {
  let pts = 0;
  for (const other of tiedTeams) {
    if (other === team) continue;
    const r = h2hResult(team, other, h2h);
    if (r === 'A') pts += 3;
    else if (r === 'draw') pts += 1;
    // null or 'B': 0
  }
  return pts;
}

/**
 * Given a simulated outcome array for the remaining matches, returns whether
 * `team` finishes in the top 2: true, false, or 'uncertain' (GD/lots needed).
 */
function isTop2(team, table, realH2H, remaining, outcomes) {
  // 1. Compute final points per team.
  const finalPts = new Map(table.map((r) => [r.team, r.pts]));
  const simH2H = new Map(realH2H);

  for (let i = 0; i < remaining.length; i++) {
    const [home, away] = remaining[i];
    const o = outcomes[i];
    if (o === 'home_win') {
      finalPts.set(home, finalPts.get(home) + 3);
      simH2H.set(`${home}|${away}`, { h: 1, a: 0 });
    } else if (o === 'draw') {
      finalPts.set(home, finalPts.get(home) + 1);
      finalPts.set(away, finalPts.get(away) + 1);
      simH2H.set(`${home}|${away}`, { h: 0, a: 0 });
    } else {
      finalPts.set(away, finalPts.get(away) + 3);
      simH2H.set(`${home}|${away}`, { h: 0, a: 1 });
    }
  }

  const teamPts = finalPts.get(team);
  const teams = table.map((r) => r.team);

  // Teams with strictly more points are definitively above.
  const aboveByPts = teams.filter((t) => t !== team && finalPts.get(t) > teamPts);
  if (aboveByPts.length >= 2) return false;

  // Teams tied on points — apply H2H.
  const tiedOnPts = teams.filter((t) => t !== team && finalPts.get(t) === teamPts);
  if (tiedOnPts.length === 0) return aboveByPts.length < 2;

  // H2H points within the entire tied group (team included).
  const tiedGroup = [team, ...tiedOnPts];
  const h2hPts = new Map(tiedGroup.map((t) => [t, h2hPtsAmong(t, tiedGroup, simH2H)]));
  const teamH2H = h2hPts.get(team);

  const aboveByH2H = tiedOnPts.filter((t) => h2hPts.get(t) > teamH2H);
  const stillTied = tiedOnPts.filter((t) => h2hPts.get(t) === teamH2H);

  const totalAbove = aboveByPts.length + aboveByH2H.length;
  if (totalAbove >= 2) return false;
  if (stillTied.length === 0) return totalAbove < 2;

  // Remaining tie needs GD → uncertain.
  return 'uncertain';
}

// ── Condition text synthesis ──────────────────────────────────────────────────

/**
 * Given a set of permutations for a team (each with outcomes[] and result),
 * synthesises a single Romanian scenario sentence.
 * Returns null for teams that are fully decided (all true or all false)
 * so callers can skip them.
 */
function synthesiseText(team, remaining, permResults) {
  const trueCount = permResults.filter((p) => p.result === true).length;
  const totalCount = permResults.length;
  const uncertainCount = permResults.filter((p) => p.result === 'uncertain').length;

  if (trueCount === totalCount) return null; // already qualified — skip
  if (trueCount === 0 && uncertainCount === 0) return null; // eliminated — skip

  // Only uncertain paths remain (no guaranteed top-2 outcome).
  if (trueCount === 0) {
    return `${team} poate avansa doar printr-un scenariu incert (departajare specială).`;
  }

  // Find team's own remaining match index (if any).
  const ownIdx = remaining.findIndex(([h, a]) => h === team || a === team);

  // Collapse permutations: treat 'uncertain' as false (conservative — only state
  // conditions we're certain about).
  const qualifying = permResults.filter((p) => p.result === true);

  // Case: team has no remaining match of their own (already played all 3).
  if (ownIdx === -1) {
    if (qualifying.length === totalCount) return null; // already qualifies regardless
    // Check which outcome of the only "other" match helps.
    if (remaining.length === 1) {
      return otherMatchText(team, remaining[0], qualifying.map((p) => p.outcomes[0]));
    }
    return `${team} mai poate avansa dacă rezultatele celorlalte meciuri sunt favorabile.`;
  }

  const [ownHome, ownAway] = remaining[ownIdx];
  const opponent = ownHome === team ? ownAway : ownHome;
  const teamIsHome = ownHome === team;

  // Group qualifying permutations by team's own result.
  const byOwnResult = { win: [], draw: [], loss: [] };
  for (const p of qualifying) {
    const o = p.outcomes[ownIdx];
    const key = teamIsHome
      ? (o === 'home_win' ? 'win' : o === 'draw' ? 'draw' : 'loss')
      : (o === 'away_win' ? 'win' : o === 'draw' ? 'draw' : 'loss');
    byOwnResult[key].push(p);
  }

  const winCount = byOwnResult.win.length;
  const drawCount = byOwnResult.draw.length;
  const lossCount = byOwnResult.loss.length;

  // Possible "other matches" in the group (excluding team's own).
  const otherIndices = remaining.map((_, i) => i).filter((i) => i !== ownIdx);
  const otherIdx = otherIndices.length === 1 ? otherIndices[0] : -1;
  // Number of possible outcomes for the "other" match (or just 1 if none).
  const otherTotal = otherIdx >= 0 ? 3 : 1;

  // Win always qualifies, draw always qualifies → "dacă nu pierde"
  if (winCount === otherTotal && drawCount === otherTotal) {
    return `${team} se califică dacă nu pierde cu ${opponent}.`;
  }

  // Win always qualifies, draw never → "dacă bate"
  if (winCount === otherTotal && drawCount === 0 && lossCount === 0) {
    return `${team} se califică dacă bate ${opponent}.`;
  }

  // Win qualifies conditionally on other match; draw/loss never.
  if (drawCount === 0 && lossCount === 0 && otherIdx >= 0) {
    const winOtherOutcomes = byOwnResult.win.map((p) => p.outcomes[otherIdx]);
    const cond = otherMatchText(team, remaining[otherIdx], winOtherOutcomes);
    if (cond) return `${team} se califică dacă bate ${opponent}${cond}.`;
  }

  // Win always qualifies, draw qualifies conditionally on other match.
  if (winCount === otherTotal && drawCount > 0 && drawCount < otherTotal && otherIdx >= 0) {
    const drawOtherOutcomes = byOwnResult.draw.map((p) => p.outcomes[otherIdx]);
    const cond = otherMatchText(team, remaining[otherIdx], drawOtherOutcomes);
    if (cond) return `${team} se califică dacă bate ${opponent}, sau cu egal dacă ${cond}.`;
  }

  // Fallback for complex cases.
  if (trueCount > 0 && trueCount < totalCount) {
    return `${team} mai are șanse de calificare.`;
  }
  return null;
}

/**
 * Describes the condition on an "other match" [home, away] that must hold
 * given which of its outcomes (home_win/draw/away_win) lead to qualification.
 * Returns " ȘI <condition>" string or null for unsupported patterns.
 */
function otherMatchText(team, [home, away], helpingOutcomes) {
  const set = new Set(helpingOutcomes);
  if (set.size === 3) return ''; // all outcomes help — no condition needed
  if (set.size === 0) return null; // no outcomes help

  if (set.has('home_win') && set.has('draw') && !set.has('away_win'))
    return ` ȘI ${away} nu bate ${home}`;
  if (!set.has('home_win') && set.has('draw') && set.has('away_win'))
    return ` ȘI ${home} nu bate ${away}`;
  if (set.has('home_win') && !set.has('draw') && !set.has('away_win'))
    return ` ȘI ${home} bate ${away}`;
  if (!set.has('home_win') && !set.has('draw') && set.has('away_win'))
    return ` ȘI ${away} bate ${home}`;
  return null; // unusual pattern (e.g., only a draw helps) — let caller fall back
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns a Map<teamName, scenarioText | null> for one group.
 * null means the team is already decided (qualified or eliminated from top-2)
 * and no scenario text is needed.
 *
 * @param {Array} table - group standing rows: { team, pts, p, gd }
 * @param {Array} allGroupMatches - all played matches for this group (home/away/score)
 */
export function computeGroupScenarios(table, allGroupMatches) {
  const teams = new Set(table.map((r) => r.team));
  const remaining = deriveRemaining(teams, allGroupMatches);
  const realH2H = buildH2H(allGroupMatches);
  const allOutcomes = enumerateOutcomes(remaining.length);

  const result = new Map();

  for (const row of table) {
    const team = row.team;

    // Skip teams already done with their matches that are fully decided.
    // We still run the enumeration — synthesiseText returns null for them.
    if (remaining.length === 0) {
      result.set(team, null);
      continue;
    }

    const permResults = allOutcomes.map((outcomes) => ({
      outcomes,
      result: isTop2(team, table, realH2H, remaining, outcomes),
    }));

    const text = synthesiseText(team, remaining, permResults);
    result.set(team, text);
  }

  return result;
}

/**
 * Computes scenarios for every group and returns
 * Map<groupName, Map<teamName, scenarioText | null>>.
 *
 * `groups` is the raw ESPN standings array ({ name, table }[]).
 * `allMatches` is the merged list of historical + tonight's finished matches.
 */
export function computeScenarios(groups, allMatches) {
  const byGroup = new Map();
  for (const group of groups) {
    const groupTeams = new Set(group.table.map((r) => r.team));
    const groupMatches = allMatches.filter(
      (m) => groupTeams.has(m.home) && groupTeams.has(m.away),
    );
    byGroup.set(group.name, computeGroupScenarios(group.table, groupMatches));
  }
  return byGroup;
}

/**
 * Looks up the scenario text for a team across all groups.
 * Returns the text string, or null if the team is decided / not found.
 */
export function scenarioFor(teamName, scenarios) {
  for (const groupMap of scenarios.values()) {
    if (groupMap.has(teamName)) return groupMap.get(teamName) ?? null;
  }
  return null;
}

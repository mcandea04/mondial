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

  // The team sits in an unresolved GD tie with `stillTied`. It is still guaranteed
  // top-2 when even the worst case — every tied rival ranked above it on goal
  // difference — leaves fewer than two teams above (the tie only settles 1st vs
  // 2nd, not who qualifies). Only when GD could push it to 3rd is it uncertain.
  if (totalAbove + stillTied.length <= 1) return true;
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

// ── Decisive-matchday joint scenario ──────────────────────────────────────────

/**
 * Describes the condition on the "other" simultaneous match [home, away] implied
 * by which of its outcomes (home_win / draw / away_win) keep a team's path alive.
 * Returns a small structured helper the narrator can voice, or null when every
 * outcome (or none) helps.
 */
function helperFor([home, away], helpingOutcomes) {
  const set = new Set(helpingOutcomes);
  if (set.size === 0 || set.size === 3) return null;
  const has = (o) => set.has(o);
  if (has('home_win') && has('draw') && !has('away_win')) return { needs: 'not_win', team: away, vs: home };
  if (!has('home_win') && has('draw') && has('away_win')) return { needs: 'not_win', team: home, vs: away };
  if (has('home_win') && !has('draw') && !has('away_win')) return { needs: 'win', team: home, vs: away };
  if (!has('home_win') && !has('draw') && has('away_win')) return { needs: 'win', team: away, vs: home };
  if (has('home_win') && has('away_win') && !has('draw')) return { needs: 'not_draw', home, away };
  if (set.size === 1 && has('draw')) return { needs: 'draw', home, away };
  return { needs: 'other', home, away, outcomes: [...set] };
}

/** Collapses a team's per-result (win/draw/loss) classification into one primary tag. */
function summariseTag(result) {
  const k = (r) => r.kind;
  if (k(result.win) === 'through' && k(result.draw) === 'through' && k(result.loss) === 'through') return 'qualified';
  if (k(result.win) === 'out' && k(result.draw) === 'out' && k(result.loss) === 'out') return 'eliminated';
  if (k(result.win) === 'through' && k(result.draw) === 'through') return 'no_loss';
  if (k(result.win) === 'through_if') return 'conditional';
  if (k(result.win) === 'through') return 'win';
  if (k(result.win) === 'gd' || k(result.draw) === 'gd') return 'goal_diff';
  return 'contention';
}

/**
 * Structured per-team conditions for a group whose two final matches are
 * simultaneous (the decisive matchday). Returns null unless exactly two matches
 * remain. The narrator turns these facts into one prose paragraph.
 *
 * Per team we report, for each of its own three results (win/draw/loss), whether
 * that lands the team in the top 2 ('through'), keeps it alive only on a specific
 * other-match result ('through_if' + helper), comes down to goal difference
 * ('gd'), or is hopeless ('out'). Nothing here resolves a GD tie — those surface
 * as kind:'gd' / tag:'goal_diff' for the narrator to name, never compute.
 */
export function computeDecisiveGroupScenario(table, allGroupMatches) {
  const teamSet = new Set(table.map((r) => r.team));
  const remaining = deriveRemaining(teamSet, allGroupMatches);
  if (remaining.length !== 2) return null;

  const realH2H = buildH2H(allGroupMatches);
  const outcomes = enumerateOutcomes(2);

  const classifyOwn = (arr, otherMatch) => {
    const vals = arr.map((x) => x.result);
    if (vals.every((v) => v === true)) return { kind: 'through' };
    if (vals.every((v) => v === false)) return { kind: 'out' };
    const trueOthers = arr.filter((x) => x.result === true).map((x) => x.other);
    if (trueOthers.length > 0) return { kind: 'through_if', helper: helperFor(otherMatch, trueOthers) };
    if (vals.some((v) => v === 'uncertain')) return { kind: 'gd' };
    return { kind: 'out' };
  };

  const teams = table.map((row) => {
    const team = row.team;
    const ownIdx = remaining.findIndex(([h, a]) => h === team || a === team);
    const otherIdx = ownIdx === 0 ? 1 : 0;
    const [oh, oa] = remaining[ownIdx];
    const opponent = oh === team ? oa : oh;
    const teamIsHome = oh === team;
    const otherMatch = remaining[otherIdx];

    const byOwn = { win: [], draw: [], loss: [] };
    for (const o of outcomes) {
      const result = isTop2(team, table, realH2H, remaining, o);
      const own = o[ownIdx];
      const key = teamIsHome
        ? (own === 'home_win' ? 'win' : own === 'draw' ? 'draw' : 'loss')
        : (own === 'away_win' ? 'win' : own === 'draw' ? 'draw' : 'loss');
      byOwn[key].push({ other: o[otherIdx], result });
    }

    const resultByOwn = {
      win: classifyOwn(byOwn.win, otherMatch),
      draw: classifyOwn(byOwn.draw, otherMatch),
      loss: classifyOwn(byOwn.loss, otherMatch),
    };

    return {
      team,
      opponent,
      otherMatch: { home: otherMatch[0], away: otherMatch[1] },
      result: resultByOwn,
      tag: summariseTag(resultByOwn),
    };
  });

  return { remaining, teams };
}

// ── Deterministic fallback paragraph ──────────────────────────────────────────
// Used ONLY when the narrator omits a decisive group's `groups` entry. The
// model's voice is always preferred; this just guarantees a decisive night never
// ships with the qualification picture missing. Plain, factual prose straight
// from the structured conditions — no invented numbers, GD ties stay named.

const GROUP_PHRASES = {
  ro: {
    lead: (name) => `Grupa ${name} se decide diseară în două meciuri simultane.`,
    helper: (h, n) => {
      if (!h) return 'rezultatele din celălalt meci o ajută';
      if (h.needs === 'not_win') return `${n(h.team)} n-o bate pe ${n(h.vs)}`;
      if (h.needs === 'win') return `${n(h.team)} o bate pe ${n(h.vs)}`;
      if (h.needs === 'draw') return `${n(h.home)} și ${n(h.away)} remizează`;
      if (h.needs === 'not_draw') return `${n(h.home)} și ${n(h.away)} nu remizează`;
      return 'celălalt meci iese cum trebuie';
    },
    team: (t, n, h) => {
      switch (t.tag) {
        case 'qualified': return `${n(t.team)} e deja calificată.`;
        case 'eliminated': return `${n(t.team)} e deja eliminată.`;
        case 'no_loss': return `${n(t.team)} se califică dacă nu pierde cu ${n(t.opponent)}.`;
        case 'win': return `${n(t.team)} are nevoie de victorie cu ${n(t.opponent)}.`;
        case 'conditional': return `${n(t.team)} se califică dacă bate ${n(t.opponent)} și ${h}.`;
        case 'goal_diff': return `${n(t.team)} mai poate trece doar la golaveraj.`;
        default: return `${n(t.team)} mai are șanse, dar calificarea atârnă de alte rezultate.`;
      }
    },
  },
  en: {
    lead: (name) => `Group ${name} is settled tonight across two simultaneous matches.`,
    helper: (h, n) => {
      if (!h) return 'the other match falls their way';
      if (h.needs === 'not_win') return `${n(h.team)} fail to beat ${n(h.vs)}`;
      if (h.needs === 'win') return `${n(h.team)} beat ${n(h.vs)}`;
      if (h.needs === 'draw') return `${n(h.home)} and ${n(h.away)} draw`;
      if (h.needs === 'not_draw') return `${n(h.home)} and ${n(h.away)} avoid a draw`;
      return 'the other match falls their way';
    },
    team: (t, n, h) => {
      switch (t.tag) {
        case 'qualified': return `${n(t.team)} are already through.`;
        case 'eliminated': return `${n(t.team)} are already out.`;
        case 'no_loss': return `${n(t.team)} go through if they avoid defeat to ${n(t.opponent)}.`;
        case 'win': return `${n(t.team)} need to beat ${n(t.opponent)}.`;
        case 'conditional': return `${n(t.team)} go through if they beat ${n(t.opponent)} and ${h}.`;
        case 'goal_diff': return `${n(t.team)} can only advance on goal difference.`;
        default: return `${n(t.team)} are still alive, but it hinges on the other results.`;
      }
    },
  },
};

/**
 * Builds the fallback prose paragraph for one decisive group in `lang`.
 * `localizeName` maps a stored (Romanian) team name to the active language —
 * identity for RO, englishTeamName for EN.
 */
export function synthesizeGroupParagraph(decisive, lang = 'ro', localizeName = (name) => name) {
  const phrases = GROUP_PHRASES[lang] ?? GROUP_PHRASES.ro;
  const n = (name) => localizeName(name);
  const sentences = decisive.teams.map((t) =>
    phrases.team(t, n, phrases.helper(t.result.win.helper, n)),
  );
  return [phrases.lead(decisive.name), ...sentences].join(' ');
}

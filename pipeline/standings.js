/**
 * Group standings status classification — MVP (Phase 1) version.
 *
 * Conservative, point-based math only. The exact scenario engine (head-to-head
 * tiebreakers, best-thirds ranking) is Phase 2; until then a team is only marked
 * `calificată` or `eliminată` when no tiebreaker could change the verdict.
 *
 * 2026 format: 12 groups of 4, top 2 advance + 8 best third-placed teams.
 */

const MATCHES_PER_TEAM = 3;

/**
 * Statuses:
 * - `calificată`: top-2 finish guaranteed on points alone
 * - `eliminată`: guaranteed 4th place on points (3rd can still advance among
 *   the 8 best thirds, so only a locked 4th is mathematically out)
 * - `în cărți`: everything else (MVP has no `are nevoie de minune` — Phase 2)
 */
export function classifyGroup(table) {
  return table.map((row) => ({
    ...row,
    status: classifyTeam(row, table),
  }));
}

function maxPoints(row) {
  return row.pts + (MATCHES_PER_TEAM - row.p) * 3;
}

function classifyTeam(row, table) {
  const others = table.filter((r) => r.team !== row.team);

  // Guaranteed top-2: at most one other team can still reach our points.
  // Strict comparison both ways keeps it conservative around ties, where
  // tiebreakers (Phase 2) would be needed for a verdict.
  const canCatchUs = others.filter((other) => maxPoints(other) >= row.pts).length;
  if (canCatchUs <= 1) {
    return 'calificată';
  }

  // Guaranteed 4th: every other team already has strictly more points than
  // we can still reach (ties go to tiebreakers, so they don't eliminate).
  if (others.every((other) => other.pts > maxPoints(row))) {
    return 'eliminată';
  }

  return 'în cărți';
}

/** Applies classification to every group from fetch.js parseStandings(). */
export function classifyStandings(groups) {
  return groups.map((group) => ({
    name: group.name,
    table: classifyGroup(group.table),
  }));
}

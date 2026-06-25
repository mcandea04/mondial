/**
 * Group standings status classification with H2H tiebreaker support.
 *
 * 2026 FIFA format: when teams finish level on points in a group, the first
 * tiebreaker is head-to-head record (H2H) within the tied teams — not overall
 * goal difference. This means a team that beat all its point-equals is
 * guaranteed to finish above them even in a tie.
 *
 * 2026 format: 12 groups of 4, top 2 advance + 8 best third-placed teams.
 */

const MATCHES_PER_TEAM = 3;

/**
 * Statuses:
 * - `calificată`: top-2 finish guaranteed (points + H2H)
 * - `eliminată`: guaranteed 4th place (points + H2H; 3rd can still advance
 *   among the 8 best thirds, so only a locked 4th is mathematically out)
 * - `în cărți`: everything else
 */
export function classifyGroup(table, matches = []) {
  const h2h = buildH2H(matches);

  // A finished group has no remaining outcomes, so the final order is locked: top 2 are
  // calificată, 3rd stays în cărți (best-thirds race across groups is still open), 4th is
  // eliminată. This resolves point-ties that the reachability rules below can't (a drawn
  // H2H separated only by a later tiebreaker like goal difference).
  if (table.every((r) => r.p >= MATCHES_PER_TEAM)) {
    const finalOrder = rankFinal(table, h2h);
    const statusByPosition = ['calificată', 'calificată', 'în cărți', 'eliminată'];
    const rankOf = new Map(finalOrder.map((r, i) => [r.team, i]));
    return table.map((row) => ({
      ...row,
      status: statusByPosition[rankOf.get(row.team)] ?? 'în cărți',
    }));
  }

  return table.map((row) => ({
    ...row,
    status: classifyTeam(row, table, h2h),
  }));
}

/**
 * Final group order using the 2026 tiebreaker chain, applied only to completed groups:
 * points, then the H2H mini-table among the teams still tied, then overall goal
 * difference, with team name as a stable last resort.
 */
function rankFinal(table, h2h) {
  return [...table].sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    const tied = table.filter((r) => r.pts === a.pts).map((r) => r.team);
    const h2hDiff = h2hPoints(b.team, tied, h2h) - h2hPoints(a.team, tied, h2h);
    if (h2hDiff !== 0) return h2hDiff;
    if (b.gd !== a.gd) return b.gd - a.gd;
    return a.team.localeCompare(b.team);
  });
}

/** Points a team earned in matches played only against the other tied teams. */
function h2hPoints(team, tied, h2h) {
  let pts = 0;
  for (const rival of tied) {
    if (rival === team) continue;
    const r = h2hResult(team, rival, h2h);
    if (r === 'A') pts += 3;
    else if (r === 'draw') pts += 1;
  }
  return pts;
}

export function buildH2H(matches) {
  const map = new Map();
  for (const m of matches) {
    if (!m.score || m.score[0] == null || m.score[1] == null) continue;
    map.set(`${m.home}|${m.away}`, { h: m.score[0], a: m.score[1] });
  }
  return map;
}

/** Returns 'A' if teamA won, 'B' if teamB won, 'draw', or null if not played. */
export function h2hResult(teamA, teamB, h2h) {
  const ab = h2h.get(`${teamA}|${teamB}`);
  if (ab) return ab.h > ab.a ? 'A' : ab.h < ab.a ? 'B' : 'draw';
  const ba = h2h.get(`${teamB}|${teamA}`);
  if (ba) return ba.h > ba.a ? 'B' : ba.h < ba.a ? 'A' : 'draw';
  return null;
}

function maxPoints(row) {
  return row.pts + (MATCHES_PER_TEAM - row.p) * 3;
}

function classifyTeam(row, table, h2h) {
  const others = table.filter((r) => r.team !== row.team);
  const myMax = maxPoints(row);

  // Can `other` finish above `row`?
  // Yes if other can reach strictly more points (H2H irrelevant).
  // Yes if other can reach the same points AND didn't lose to row in H2H.
  function canFinishAbove(other) {
    const otherMax = maxPoints(other);
    if (otherMax > row.pts) return true;
    if (otherMax === row.pts) return h2hResult(row.team, other.team, h2h) !== 'A';
    return false;
  }

  // calificată: at most one other team can finish above us.
  if (others.filter(canFinishAbove).length <= 1) return 'calificată';

  // Is `other` definitively above `row`?
  // Yes if other already has more points than row's max (already out of reach).
  // Yes if other's current points equal row's max AND other beat row in H2H.
  function definitivelyAbove(other) {
    if (other.pts > myMax) return true;
    if (other.pts === myMax) return h2hResult(row.team, other.team, h2h) === 'B';
    return false;
  }

  // eliminată: every other team is definitively above us.
  if (others.every(definitivelyAbove)) return 'eliminată';

  return 'în cărți';
}

/** Applies classification to every group from espn.js parseStandings(). */
export function classifyStandings(groups, allMatches = []) {
  return groups.map((group) => {
    const groupTeams = new Set(group.table.map((r) => r.team));
    const groupMatches = allMatches.filter(
      (m) => groupTeams.has(m.home) && groupTeams.has(m.away),
    );
    return {
      name: group.name,
      table: classifyGroup(group.table, groupMatches),
    };
  });
}

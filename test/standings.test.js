import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyGroup } from '../pipeline/standings.js';

function row(team, p, pts, gd = 0) {
  return { team, p, w: 0, d: 0, l: 0, gd, pts };
}

function statusOf(table, team) {
  return classifyGroup(table).find((r) => r.team === team).status;
}

test('before any match everyone is în cărți', () => {
  const table = [row('A', 0, 0), row('B', 0, 0), row('C', 0, 0), row('D', 0, 0)];
  for (const r of classifyGroup(table)) {
    assert.equal(r.status, 'în cărți');
  }
});

test('6 points after two games with weak chasers is calificată', () => {
  // A has 6; B, C, D can reach at most 4 — nobody catches A, guaranteed top-2.
  const table = [row('A', 2, 6), row('B', 2, 1), row('C', 2, 1), row('D', 2, 0)];
  assert.equal(statusOf(table, 'A'), 'calificată');
});

test('6 points is NOT calificată while two chasers can still reach 6', () => {
  // B and C on 3 points with a game left can reach 6 → tie on points possible.
  const table = [row('A', 2, 6), row('B', 2, 3), row('C', 2, 3), row('D', 2, 0)];
  assert.equal(statusOf(table, 'A'), 'în cărți');
});

test('guaranteed 4th place is eliminată', () => {
  // D has 0 points after 2 games (max 3); all others already have 4+.
  const table = [row('A', 2, 6), row('B', 2, 4), row('C', 2, 4), row('D', 2, 0)];
  assert.equal(statusOf(table, 'D'), 'eliminată');
});

test('0 points after two games is NOT eliminată when 3rd place is reachable', () => {
  // D can reach 3; C has 2 → D can still finish 3rd and advance among best thirds.
  const table = [row('A', 2, 6), row('B', 2, 4), row('C', 2, 2), row('D', 2, 0)];
  assert.equal(statusOf(table, 'D'), 'în cărți');
});

test('tie on points does not eliminate (tiebreakers are Phase 2)', () => {
  // D max is exactly C's current points → tiebreaker territory, stay în cărți.
  const table = [row('A', 2, 6), row('B', 2, 4), row('C', 2, 3), row('D', 2, 0)];
  assert.equal(statusOf(table, 'D'), 'în cărți');
});

test('after all games: clear top-2 calificată, 4th eliminată, 3rd în cărți', () => {
  const table = [row('A', 3, 9), row('B', 3, 6), row('C', 3, 3), row('D', 3, 0)];
  const classified = classifyGroup(table);
  assert.equal(classified.find((r) => r.team === 'A').status, 'calificată');
  assert.equal(classified.find((r) => r.team === 'B').status, 'calificată');
  // C is 3rd: may still advance among best thirds, so not eliminated.
  assert.equal(classified.find((r) => r.team === 'C').status, 'în cărți');
  assert.equal(classified.find((r) => r.team === 'D').status, 'eliminată');
});

// ── H2H tiebreaker tests ──────────────────────────────────────────────────────

function match(home, away, hGoals, aGoals) {
  return { home, away, score: [hGoals, aGoals], group: 'X' };
}

test('leader who beat both point-equal chasers is calificată via H2H', () => {
  // A: 6 pts (2 played). B and C: 3 pts (2 played), can each reach 6.
  // Without H2H: two chasers can tie A on points → în cărți.
  // With H2H wins over both: A is guaranteed top-2.
  const table = [row('A', 2, 6), row('B', 2, 3), row('C', 2, 3), row('D', 2, 0)];
  const matches = [match('A', 'B', 4, 1), match('A', 'C', 2, 0)];
  assert.equal(statusOf(table, 'A'), 'în cărți');           // without H2H: ambiguous
  assert.equal(classifyGroup(table, matches).find((r) => r.team === 'A').status, 'calificată');
});

test('trailer who lost H2H to all point-equal rivals is eliminată', () => {
  // D: 0 pts (2 played), max 3. B and C: 3 pts (2 played) — equal to D's max.
  // Without H2H: tie on points → not eliminated.
  // With H2H losses to B and C: D cannot finish above either, so it's locked 4th.
  const table = [row('A', 2, 6), row('B', 2, 3), row('C', 2, 3), row('D', 2, 0)];
  const matches = [match('B', 'D', 2, 0), match('C', 'D', 1, 0)];
  assert.equal(statusOf(table, 'D'), 'în cărți');           // without H2H: ambiguous
  assert.equal(classifyGroup(table, matches).find((r) => r.team === 'D').status, 'eliminată');
});

test('H2H draw or missing result stays conservative (în cărți)', () => {
  // Same setup as the elimination test but D drew both H2H matches.
  const table = [row('A', 2, 6), row('B', 2, 3), row('C', 2, 3), row('D', 2, 0)];
  const draws = [match('B', 'D', 1, 1), match('C', 'D', 0, 0)];
  assert.equal(classifyGroup(table, draws).find((r) => r.team === 'D').status, 'în cărți');
  // Also: only one H2H played — still conservative.
  const partial = [match('B', 'D', 2, 0)];
  assert.equal(classifyGroup(table, partial).find((r) => r.team === 'D').status, 'în cărți');
});

// ── Completed-group classification ──────────────────────────────────────────────
// Once every game is played the group order is final, so 2nd place is qualified even
// when a points-tie was only separated by a later tiebreaker (GD), not by H2H.

test('completed group: 2nd place on a drawn H2H is calificată via goal difference', () => {
  // Real Group B (2026-06-25): Canada and Bosnia both on 4 pts, drew their H2H,
  // Canada ahead on overall GD (+5 vs -1). Canada is the 2nd qualifier.
  const table = [row('A', 3, 7, 4), row('B', 3, 4, 5), row('C', 3, 4, -1), row('D', 3, 1, -8)];
  const matches = [match('B', 'C', 1, 1)];
  const classified = classifyGroup(table, matches);
  assert.equal(classified.find((r) => r.team === 'A').status, 'calificată');
  assert.equal(classified.find((r) => r.team === 'B').status, 'calificată');
  assert.equal(classified.find((r) => r.team === 'C').status, 'în cărți'); // 3rd: best-thirds race open
  assert.equal(classified.find((r) => r.team === 'D').status, 'eliminată');
});

test('completed group: H2H outranks goal difference for the 2nd slot', () => {
  // B and C tie on 4 pts; C has the better GD but lost the H2H to B, so B takes 2nd.
  const table = [row('A', 3, 7, 4), row('B', 3, 4, 1), row('C', 3, 4, 6), row('D', 3, 1, -8)];
  const matches = [match('B', 'C', 1, 0)];
  const classified = classifyGroup(table, matches);
  assert.equal(classified.find((r) => r.team === 'B').status, 'calificată');
  assert.equal(classified.find((r) => r.team === 'C').status, 'în cărți');
});

test('completed group: 3-way tie resolved by the H2H mini-table', () => {
  // A clear winner on 9; B, C, D all on 3 pts. Mini-table among the tied three:
  // B beat C, C beat D, D beat B → all 3 pts in the mini-table, so overall GD breaks it.
  // Give B the best GD, then C, then D → B 2nd (calificată), C 3rd (în cărți), D 4th (eliminată).
  const table = [row('A', 3, 9, 9), row('B', 3, 3, 2), row('C', 3, 3, 0), row('D', 3, 3, -2)];
  const matches = [match('B', 'C', 1, 0), match('C', 'D', 1, 0), match('D', 'B', 1, 0)];
  const classified = classifyGroup(table, matches);
  assert.equal(classified.find((r) => r.team === 'A').status, 'calificată');
  assert.equal(classified.find((r) => r.team === 'B').status, 'calificată');
  assert.equal(classified.find((r) => r.team === 'C').status, 'în cărți');
  assert.equal(classified.find((r) => r.team === 'D').status, 'eliminată');
});

test('incomplete group with the same drawn H2H tie stays conservative', () => {
  // Identical points/GD to the Group B case but a game still to play (p=2): the tie
  // could still flip, so both tied teams remain undecided.
  const table = [row('A', 2, 7, 4), row('B', 2, 4, 5), row('C', 2, 4, -1), row('D', 2, 1, -8)];
  const matches = [match('B', 'C', 1, 1)];
  const classified = classifyGroup(table, matches);
  assert.equal(classified.find((r) => r.team === 'B').status, 'în cărți');
  assert.equal(classified.find((r) => r.team === 'C').status, 'în cărți');
});

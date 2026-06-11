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

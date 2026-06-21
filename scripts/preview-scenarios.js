#!/usr/bin/env node
/**
 * Read-only inspection tool for the qualification scenario engine.
 *
 * Reads live ESPN standings + committed match history and prints, per group:
 *   1. The current table (team, P, pts, GD)
 *   2. The derived remaining fixtures
 *   3. The computed scenario fact for each team
 *
 * Nothing is written — the published digest is untouched.
 *
 * Usage:
 *   node scripts/preview-scenarios.js
 *   node scripts/preview-scenarios.js --date 2026-06-24
 *   node scripts/preview-scenarios.js --fixtures test/fixtures
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { activeDigestDate, fetchDigestData, parseStandings } from '../pipeline/espn.js';
import { computeScenarios } from '../pipeline/scenarios.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA_DIR = path.join(ROOT, 'site', 'data');

// ── Args ──────────────────────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, arg, i, arr) => {
    if (arg.startsWith('--')) acc.push([arg.slice(2), arr[i + 1] ?? true]);
    return acc;
  }, []),
);

const date = typeof args.date === 'string' ? args.date : activeDigestDate();
const fixturesDir = typeof args.fixtures === 'string' ? path.resolve(args.fixtures) : null;

// ── Historical matches from committed digests ─────────────────────────────────

async function historicalMatches() {
  if (!existsSync(DATA_DIR)) return [];
  const files = (await readdir(DATA_DIR))
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .filter((name) => name.slice(0, 10) < date)
    .sort();
  const all = [];
  for (const file of files) {
    try {
      const digest = JSON.parse(await readFile(path.join(DATA_DIR, file), 'utf8'));
      all.push(...(digest.matches ?? []));
    } catch {
      // skip corrupt file
    }
  }
  return all;
}

// ── Fetch standings + last-night matches ──────────────────────────────────────

async function gatherData() {
  if (fixturesDir) {
    const readFixture = async (file) => {
      try {
        return JSON.parse(await readFile(path.join(fixturesDir, file), 'utf8'));
      } catch {
        return {};
      }
    };
    const fixtureCache = new Map();
    const fixtureBody = async (url) => {
      if (url.includes('/standings')) {
        if (!fixtureCache.has('standings'))
          fixtureCache.set('standings', await readFixture('espn-standings.json'));
        return fixtureCache.get('standings');
      }
      if (url.includes('/scoreboard')) {
        if (!fixtureCache.has('scoreboard'))
          fixtureCache.set('scoreboard', await readFixture('scoreboard.json'));
        return fixtureCache.get('scoreboard');
      }
      const m = url.match(/\/(\d+)\/summary/);
      if (m) {
        const key = `summary-${m[1]}`;
        if (!fixtureCache.has(key))
          fixtureCache.set(key, await readFixture(`summary-${m[1]}.json`));
        return fixtureCache.get(key);
      }
      return {};
    };
    const fixtureFetch = async (url) => ({ ok: true, async json() { return fixtureBody(url); } });
    return fetchDigestData({ digestDate: date, fetchImpl: fixtureFetch, delayMs: 0 });
  }
  console.log(`Fetching live ESPN data for ${date}…`);
  return fetchDigestData({ digestDate: date });
}

// ── Round-robin derivation (mirrors scenarios.js internals) ──────────────────

function allPairings(teams) {
  const arr = [...teams];
  const pairs = [];
  for (let i = 0; i < arr.length; i++)
    for (let j = i + 1; j < arr.length; j++)
      pairs.push([arr[i], arr[j]]);
  return pairs;
}

function deriveRemaining(teamSet, allGroupMatches) {
  const played = new Set(allGroupMatches.map((m) => [m.home, m.away].sort().join('|')));
  return allPairings(teamSet).filter(([a, b]) => !played.has([a, b].sort().join('|')));
}

// ── Pretty-print ──────────────────────────────────────────────────────────────

function pad(str, n) {
  return String(str).padEnd(n);
}

function printGroup(groupName, table, groupMatches, groupScenarios) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Group ${groupName}`);
  console.log('─'.repeat(60));

  // Table
  console.log(`  ${pad('Team', 24)} P   Pts  GD`);
  for (const row of table) {
    console.log(`  ${pad(row.team, 24)} ${pad(row.p, 4)}${pad(row.pts, 5)}${row.gd >= 0 ? '+' : ''}${row.gd}`);
  }

  // Remaining fixtures
  const teamSet = table.map((r) => r.team);
  const remaining = deriveRemaining(new Set(teamSet), groupMatches);
  if (remaining.length === 0) {
    console.log('\n  [Grup terminat — toate meciurile jucate]');
  } else {
    console.log(`\n  Meciuri rămase (${remaining.length}):`);
    for (const [h, a] of remaining) {
      console.log(`    ${h} vs ${a}`);
    }
  }

  // Scenario facts
  console.log('\n  Scenarii:');
  for (const [team, text] of groupScenarios) {
    if (text === null) {
      const row = table.find((r) => r.team === team);
      // Determine if decided
      const decided = remaining.length === 0 ? 'deja decis' : 'deja calificată/eliminată';
      console.log(`    ${pad(team, 24)} — ${decided}`);
    } else {
      console.log(`    ${pad(team, 24)} — ${text}`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

try {
  const [facts, historical] = await Promise.all([gatherData(), historicalMatches()]);

  if (facts.standings.length === 0) {
    console.log('No standings data available. ESPN may be unavailable or fixtures missing.');
    process.exit(1);
  }

  const allMatches = [...historical, ...facts.finished];

  console.log(`\nScenarios preview — digest date: ${date}`);
  console.log(`Historical matches loaded: ${historical.length}`);
  console.log(`Last-night finished matches: ${facts.finished.length}`);

  const scenarios = computeScenarios(facts.standings, allMatches);

  for (const group of facts.standings) {
    const groupTeams = new Set(group.table.map((r) => r.team));
    const groupMatches = allMatches.filter(
      (m) => groupTeams.has(m.home) && groupTeams.has(m.away),
    );
    const groupScenarios = scenarios.get(group.name) ?? new Map();
    printGroup(group.name, group.table, groupMatches, groupScenarios);
  }

  console.log('\n');
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}

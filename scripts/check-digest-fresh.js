#!/usr/bin/env node
// Dead-man switch for the nightly digest.
//
// All trigger paths (cron-job.org pinger, GitHub schedule cron) can fail
// silently -- an expired token, a service outage, a dropped run -- and the only
// symptom is that no new digest appears. This check runs late in the morning and
// fails loudly when the committed digest is not today's, so the workflow can
// email an alarm instead of the absence going unnoticed.
//
// Exit 0: latest.json is today's digest (fresh). Exit 1: stale or missing.
import { readFile } from 'node:fs/promises';
import { bucharestToday } from '../pipeline/fetch.js';

const expected = bucharestToday();

let actual;
try {
  const latest = JSON.parse(await readFile('site/data/latest.json', 'utf8'));
  actual = latest.date;
} catch (err) {
  console.error(`STALE: cannot read site/data/latest.json (${err.message})`);
  console.log(`expected=${expected} actual=`);
  process.exit(1);
}

if (actual === expected) {
  console.log(`fresh: latest.json is ${actual}`);
  process.exit(0);
}

console.error(`STALE: latest.json is ${actual}, expected ${expected}`);
console.log(`expected=${expected} actual=${actual}`);
process.exit(1);

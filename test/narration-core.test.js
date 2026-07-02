import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  narrationSchemaEn, SYSTEM_PROMPT, SYSTEM_PROMPT_EN, CRITIQUE_SYSTEM_PROMPT,
  CRITIQUE_SYSTEM_PROMPT_EN,
  buildRewriteSystemPromptEn, localizeProse,
  englishVerdict, factsWithEnglishVerdicts, buildUserMessage,
} from '../pipeline/narration-core.js';

test('narrationSchemaEn accepts the English alarm enum', () => {
  const ok = {
    headline: 'h', summary: 's',
    matches: [{ id: 1, pill: 'p', drama: 3 }],
    tonight: [{ id: 2, alarm: 'worth watching', why: 'w' }],
  };
  assert.doesNotThrow(() => narrationSchemaEn.parse(ok));
});

test('narrationSchemaEn rejects the Romanian alarm enum', () => {
  const bad = {
    headline: 'h', summary: 's', matches: [],
    tonight: [{ id: 2, alarm: 'merită văzut', why: 'w' }],
  };
  assert.throws(() => narrationSchemaEn.parse(bad));
});

test('English prompts are English and reference the alarm enum', () => {
  assert.match(SYSTEM_PROMPT_EN, /English/i);
  assert.match(SYSTEM_PROMPT_EN, /worth watching/);
  assert.match(SYSTEM_PROMPT_EN, /catch it later/);
  assert.match(CRITIQUE_SYSTEM_PROMPT_EN, /English/i);
});

test('prompts route aggregate scorer claims through goalFacts', () => {
  assert.match(SYSTEM_PROMPT, /goalFacts/);
  assert.match(SYSTEM_PROMPT, /dublă/);
  assert.match(SYSTEM_PROMPT_EN, /goalFacts/);
  assert.match(SYSTEM_PROMPT_EN, /brace/);
});

test('prompts require exactly one predictor-animal joke without inventing predictions', () => {
  assert.match(SYSTEM_PROMPT, /animale-oracol/);
  assert.match(SYSTEM_PROMPT, /Paul caracatița/);
  assert.match(SYSTEM_PROMPT, /Fiecare digest include EXACT O glumă/);
  assert.match(SYSTEM_PROMPT, /O singură referință/);
  assert.match(SYSTEM_PROMPT, /NU spune că Paul sau alt animal a prezis un meci din 2026/);
  assert.match(SYSTEM_PROMPT, /NU\s+inventa predicții/);
  assert.match(SYSTEM_PROMPT_EN, /predictor-animal joke/);
  assert.match(SYSTEM_PROMPT_EN, /Paul the Octopus/);
  assert.match(SYSTEM_PROMPT_EN, /Every digest includes EXACTLY ONE/);
  assert.match(SYSTEM_PROMPT_EN, /ONE predictor-animal reference/);
  assert.match(SYSTEM_PROMPT_EN, /do NOT claim Paul or any other animal predicted a 2026 match/);
  assert.match(SYSTEM_PROMPT_EN, /do NOT\s+invent predictions/);
});

test('prompts define knockout facts and forbid both-qualified framing', () => {
  assert.match(SYSTEM_PROMPT, /FAZA ELIMINATORIE/);
  assert.match(SYSTEM_PROMPT, /winner/);
  assert.match(SYSTEM_PROMPT, /loser/);
  assert.match(SYSTEM_PROMPT, /winnerAdvancesTo/);
  assert.match(SYSTEM_PROMPT, /sferturi/);
  assert.match(SYSTEM_PROMPT, /ambele echipe/);
  assert.match(SYSTEM_PROMPT_EN, /KNOCKOUT STAGE/);
  assert.match(SYSTEM_PROMPT_EN, /winnerAdvancesTo/);
  assert.match(SYSTEM_PROMPT_EN, /quarterfinals/);
  assert.match(SYSTEM_PROMPT_EN, /both teams qualified/);
});

test('Romanian prompt rejects TV-recap stiffness and asks for spoken rhythm', () => {
  assert.match(SYSTEM_PROMPT, /a deblocat meciul/);
  assert.match(SYSTEM_PROMPT, /a bifat/);
  assert.match(SYSTEM_PROMPT, /la fel de sprintenă ca engleza/);
  assert.match(CRITIQUE_SYSTEM_PROMPT, /execuția aeriană/);
  assert.match(CRITIQUE_SYSTEM_PROMPT, /verb concret/);
});

test('buildUserMessage carries knockout facts without group standings', () => {
  const facts = {
    date: '2026-06-29',
    phase: 'knockout',
    finished: [{
      id: 760486,
      home: 'Africa de Sud',
      away: 'Canada',
      score: [0, 1],
      stage: 'round-of-32',
      winnerAdvancesTo: 'round-of-16',
      winner: 'Canada',
      loser: 'Africa de Sud',
      scorers: [],
      events: [],
    }],
    tonight: [{
      id: 760487,
      home: 'Brazilia',
      away: 'Japonia',
      stage: 'round-of-32',
      winnerAdvancesTo: 'round-of-16',
      kickoffEEST: '20:00',
    }],
    standings: [],
  };
  const message = buildUserMessage(facts, [], null);
  assert.match(message, /"phase": "knockout"/);
  assert.match(message, /"stage": "round-of-32"/);
  assert.match(message, /"winnerAdvancesTo": "round-of-16"/);
  assert.match(message, /"winner": "Canada"/);
  assert.match(message, /"loser": "Africa de Sud"/);
  assert.match(message, /"standings": \[\]/);
  assert.doesNotMatch(message, /"status": "calificată"/);
  assert.doesNotMatch(message, /homeScenario/);
});

test('buildRewriteSystemPromptEn embeds the critique and the English voice', () => {
  const out = buildRewriteSystemPromptEn('note: avoid "thrilling encounter"');
  assert.match(out, /thrilling encounter/);
  assert.match(out, /English/i);
});

test('localizeProse mirrors the site localize', () => {
  assert.equal(localizeProse('x', 'en'), 'x');
  assert.equal(localizeProse({ ro: 'r', en: 'e' }, 'en'), 'e');
  assert.equal(localizeProse({ ro: 'r' }, 'en'), 'r');
  assert.equal(localizeProse(null, 'ro'), '');
});

test('englishVerdict maps the Romanian alarm enum (incl. legacy) to the English verdict', () => {
  assert.equal(englishVerdict('merită văzut'), 'worth watching');
  assert.equal(englishVerdict('stai treaz'), 'worth watching'); // legacy RO token
  assert.equal(englishVerdict('citești dimineața'), 'catch it later');
  assert.equal(englishVerdict(undefined), 'catch it later'); // safe default
});

test('factsWithEnglishVerdicts injects the canonical verdict per tonight fixture', () => {
  const facts = { tonight: [{ id: 1, home: 'A', away: 'B' }, { id: 2, home: 'C', away: 'D' }] };
  const roNarration = { tonight: [{ id: 1, alarm: 'merită văzut' }, { id: 2, alarm: 'citești dimineața' }] };
  const out = factsWithEnglishVerdicts(facts, roNarration);
  assert.equal(out.tonight[0].verdict, 'worth watching');
  assert.equal(out.tonight[1].verdict, 'catch it later');
  // original facts untouched
  assert.equal(facts.tonight[0].verdict, undefined);
});

test('factsWithEnglishVerdicts defaults to skip for a fixture the RO narration omits', () => {
  const facts = { tonight: [{ id: 9, home: 'X', away: 'Y' }] };
  const out = factsWithEnglishVerdicts(facts, { tonight: [] });
  assert.equal(out.tonight[0].verdict, 'catch it later');
});

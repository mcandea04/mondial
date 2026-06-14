/**
 * Claude narration engine: shells out to the headless `claude -p` CLI, which
 * spends the Pro subscription quota via a CLAUDE_CODE_OAUTH_TOKEN (the 15 EUR/mo
 * subscription provides no Anthropic API key — only the CLI can bill it). The
 * benchmark in docs/superpowers/specs/2026-06-12-prose-benchmark-design.md
 * picked Opus single-pass as the prose winner.
 *
 * The shared SYSTEM_PROMPT / narrationSchema / buildUserMessage live in
 * narration-core.js, so this engine competes on the identical contract as Gemini.
 */

import { spawn } from 'node:child_process';
import { narrationSchema, extractNarrationText } from './narration-core.js';

const JSON_INSTRUCTION =
  '\n\nIMPORTANT: răspunde DOAR cu un obiect JSON valid care respectă exact această schemă. ' +
  'Fără text introductiv, fără explicații, fără blocuri ```.\n' +
  'Schema (toate câmpurile obligatorii, fără câmpuri în plus):\n' +
  '{ "headline": string, "summary": string, ' +
  '"matches": [ { "id": number, "pill": string, "drama": number 1-5 } ], ' +
  '"tonight": [ { "id": number, "alarm": exact "stai treaz" SAU "citești dimineața", "why": string } ] }\n' +
  'ATENȚIE: "alarm" este un șir de caractere, una din cele două valori de mai sus — niciodată true/false. ' +
  '"id" copiază exact id-urile primite în fapte. Nu adăuga câmpul "date" sau altele.';

/** Spawns `claude -p` and returns { exitCode, stdout }. Replaceable in tests. */
function defaultRunCli({ model, userMessage, systemPrompt }) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', [
      '-p', userMessage,
      '--append-system-prompt', systemPrompt,
      '--model', model,
      '--output-format', 'json',
    ]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

const AUTH_SIGNAL = /invalid api key|unauthorized|please run \/login|not logged in|authentication|oauth/i;

function parseEnvelope({ exitCode, stdout }) {
  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new SyntaxError('claude CLI did not return JSON envelope');
  }
  const text = envelope.result ?? '';
  if (envelope.is_error || exitCode !== 0) {
    const err = new Error(`claude CLI error: ${text.slice(0, 200)}`);
    err.auth = AUTH_SIGNAL.test(text);
    throw err;
  }
  return text;
}

/**
 * Generates one narration via the headless claude CLI. Two-stage parse:
 * CLI envelope -> result text -> narration JSON (fence/preamble tolerant) -> zod.
 * Retries bad output up to `attempts` times (the retry message appends the
 * validation error); Opus occasionally emits an off-schema or non-JSON answer,
 * so the default leaves headroom for that. Auth failures are terminal (err.auth)
 * so run.js can fall back to Gemini immediately rather than burn retries.
 */
export async function callClaude({ model, userMessage, systemPrompt, runCli = defaultRunCli, attempts = 4 }) {
  const sys = systemPrompt + JSON_INSTRUCTION;
  let message = userMessage;
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let resultText;
    try {
      resultText = parseEnvelope(await runCli({ model, userMessage: message, systemPrompt: sys }));
    } catch (error) {
      if (error.auth) {
        const e = new Error(`claude auth failure: ${error.message}`);
        e.auth = true;
        throw e;
      }
      throw error; // CLI/spawn failure: not a bad-output case
    }
    try {
      return narrationSchema.parse(JSON.parse(extractNarrationText(resultText)));
    } catch (error) {
      lastError = error;
      message =
        `${userMessage}\n\nÎncercarea anterioară a fost invalidă: ${error.message}. ` +
        'Răspunde DOAR cu JSON valid, fără blocuri de cod, fără text în plus.';
    }
  }
  throw new Error(`claude failed to produce valid narration: ${lastError}`);
}

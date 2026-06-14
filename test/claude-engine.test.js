import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callClaude } from '../pipeline/claude-engine.js';

const VALID = {
  headline: 'Rüdiger vede roșu, Germania vede aeroportul',
  summary: 'Două propoziții. Exact două.',
  matches: [{ id: 9001, pill: 'Grupa s-a încins.', drama: 4 }],
  tonight: [{ id: 9101, alarm: 'stai treaz', why: 'Decide prima poziție.' }],
};

/** A runCli stub that returns a CLI envelope wrapping the given result text. */
function envelopeOf(resultText, { isError = false, exitCode = 0 } = {}) {
  return async () => ({ exitCode, stdout: JSON.stringify({ is_error: isError, result: resultText }) });
}

test('parses a clean JSON result envelope', async () => {
  const out = await callClaude({
    model: 'opus',
    userMessage: 'm',
    systemPrompt: 's',
    runCli: envelopeOf(JSON.stringify(VALID)),
  });
  assert.deepEqual(out, VALID);
});

test('strips a ```json fence around the result', async () => {
  const fenced = '```json\n' + JSON.stringify(VALID) + '\n```';
  const out = await callClaude({ model: 'opus', userMessage: 'm', systemPrompt: 's', runCli: envelopeOf(fenced) });
  assert.deepEqual(out, VALID);
});

test('tolerates a prose preamble before the JSON object', async () => {
  const preamble = 'Sigur, iată digestul:\n' + JSON.stringify(VALID);
  const out = await callClaude({ model: 'opus', userMessage: 'm', systemPrompt: 's', runCli: envelopeOf(preamble) });
  assert.deepEqual(out, VALID);
});

test('retries once on bad output, then succeeds', async () => {
  let calls = 0;
  const runCli = async () => {
    calls += 1;
    const result = calls === 1 ? 'not json at all' : JSON.stringify(VALID);
    return { exitCode: 0, stdout: JSON.stringify({ is_error: false, result }) };
  };
  const out = await callClaude({ model: 'opus', userMessage: 'm', systemPrompt: 's', runCli, attempts: 2 });
  assert.equal(calls, 2);
  assert.deepEqual(out, VALID);
});

test('the retry message restates the JSON-only instruction with the error', async () => {
  const seen = [];
  const runCli = async ({ userMessage }) => {
    seen.push(userMessage);
    const result = seen.length === 1 ? 'garbage' : JSON.stringify(VALID);
    return { exitCode: 0, stdout: JSON.stringify({ is_error: false, result }) };
  };
  await callClaude({ model: 'opus', userMessage: 'fapte', systemPrompt: 's', runCli, attempts: 2 });
  assert.equal(seen.length, 2);
  assert.match(seen[1], /Încercarea anterioară a fost invalidă/);
  assert.match(seen[1], /DOAR cu JSON valid/);
});

test('throws after exhausting bad-output retries', async () => {
  const runCli = envelopeOf('still not json');
  await assert.rejects(
    () => callClaude({ model: 'opus', userMessage: 'm', systemPrompt: 's', runCli, attempts: 2 }),
    /failed to produce valid narration/,
  );
});

test('an auth-signalling error is terminal and tagged err.auth', async () => {
  let calls = 0;
  const runCli = async () => {
    calls += 1;
    return { exitCode: 1, stdout: JSON.stringify({ is_error: true, result: 'Invalid API key · Please run /login' }) };
  };
  await assert.rejects(
    () => callClaude({ model: 'opus', userMessage: 'm', systemPrompt: 's', runCli, attempts: 4 }),
    (err) => err.auth === true && /auth failure/.test(err.message),
  );
  assert.equal(calls, 1, 'auth failure does not retry');
});

test('a non-JSON envelope is a hard error, not retried as bad output', async () => {
  const runCli = async () => ({ exitCode: 0, stdout: 'this is not an envelope' });
  await assert.rejects(
    () => callClaude({ model: 'opus', userMessage: 'm', systemPrompt: 's', runCli, attempts: 4 }),
    /did not return JSON envelope/,
  );
});

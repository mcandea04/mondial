import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUserMessage, normalizeSteer, narrate } from '../pipeline/narrate.js';

const facts = { date: '2026-06-12', finished: [], tonight: [], standings: [] };

const VALID_NARRATION = {
  headline: 'h',
  summary: 's',
  matches: [],
  tonight: [],
};

/** A fetch stub: 503 for the primary model, 200 (valid narration) for fallback. */
function modelRoutedFetch({ fallback, onCall }) {
  return async (url) => {
    const isFallback = String(url).includes(fallback);
    onCall(isFallback ? fallback : 'primary');
    if (!isFallback) {
      return { ok: false, status: 503, text: async () => 'high demand' };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(VALID_NARRATION) }] } }] }),
    };
  };
}

// The fallback path logs warnings by design (visible in prod Actions logs);
// silence them here so test output stays clean.
function silencingWarn() {
  const realWarn = console.warn;
  console.warn = () => {};
  return () => { console.warn = realWarn; };
}

test('narrate falls back to gemini-2.5-flash when the primary is exhausted', async () => {
  const realFetch = globalThis.fetch;
  const restoreWarn = silencingWarn();
  const calls = [];
  globalThis.fetch = modelRoutedFetch({ fallback: 'gemini-2.5-flash', onCall: (m) => calls.push(m) });
  try {
    const result = await narrate(facts, { apiKey: 'x', sleep: async () => {} });
    assert.deepEqual(result, VALID_NARRATION);
    assert.ok(calls.includes('gemini-2.5-flash'), 'fallback model was called');
    assert.ok(calls.filter((m) => m === 'primary').length >= 2, 'primary was retried before falling back');
  } finally {
    globalThis.fetch = realFetch;
    restoreWarn();
  }
});

test('narrate throws when both primary and fallback fail', async () => {
  const realFetch = globalThis.fetch;
  const restoreWarn = silencingWarn();
  globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => 'down' });
  try {
    await assert.rejects(
      narrate(facts, { apiKey: 'x', sleep: async () => {} }),
      /failed on both/,
    );
  } finally {
    globalThis.fetch = realFetch;
    restoreWarn();
  }
});

test('steer note is appended to the prompt', () => {
  const message = buildUserMessage(facts, [], 'mai puține metafore cu urși');
  assert.match(message, /NOTĂ DE LA EDITOR/);
  assert.match(message, /mai puține metafore cu urși/);
});

test('without steer the prompt is unchanged', () => {
  const message = buildUserMessage(facts, []);
  assert.doesNotMatch(message, /NOTĂ DE LA EDITOR/);
});

test('an untouched HTML-comment placeholder yields no editor note', () => {
  const message = buildUserMessage(facts, [], '<!-- scrie aici, opțional, ce vrei schimbat -->');
  assert.doesNotMatch(message, /NOTĂ DE LA EDITOR/);
});

test('a note typed alongside the placeholder keeps only the note', () => {
  const message = buildUserMessage(facts, [], '<!-- hint -->\nmai mult sarcasm');
  assert.match(message, /NOTĂ DE LA EDITOR/);
  assert.match(message, /mai mult sarcasm/);
  assert.doesNotMatch(message, /hint/);
});

test('steer combines with recent prose avoidance', () => {
  const message = buildUserMessage(facts, ['glumă veche'], 'fii mai scurt');
  assert.match(message, /glumă veche/);
  assert.match(message, /fii mai scurt/);
});

test('normalizeSteer collapses empty and comment-only input to null', () => {
  assert.equal(normalizeSteer(''), null);
  assert.equal(normalizeSteer(null), null);
  assert.equal(normalizeSteer('   '), null);
  assert.equal(normalizeSteer('<!-- only a comment -->'), null);
  assert.equal(normalizeSteer('real note'), 'real note');
});

test('narrate threads gold into the user message', async () => {
  const realFetch = globalThis.fetch;
  let sentBody = null;
  globalThis.fetch = async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(VALID_NARRATION) }] } }] }),
    };
  };
  try {
    await narrate(facts, { apiKey: 'x', gold: [{ field: 'pill', text: 'aur' }], sleep: async () => {} });
  } finally {
    globalThis.fetch = realFetch;
  }
  const userText = sentBody.contents[0].parts[0].text;
  assert.match(userText, /EXEMPLE DE TON REUȘIT/);
  assert.match(userText, /PILL: aur/);
});

// Guard against schema drift: the Gemini structured-output schema controls which
// fields the model can physically emit. A field present in the zod schema but
// missing here means the model can never return it (the bug that silently dropped
// every decisive-matchday `groups` paragraph in production).
test('Gemini response schema declares every field the zod schema accepts', async () => {
  const { responseSchema, responseSchemaEn } = await import('../pipeline/narrate.js');
  const { narrationSchema, narrationSchemaEn } = await import('../pipeline/narration-core.js');
  for (const [gemini, zod] of [[responseSchema, narrationSchema], [responseSchemaEn, narrationSchemaEn]]) {
    for (const key of Object.keys(zod.shape)) {
      assert.ok(gemini.properties[key], `Gemini schema missing "${key}" the model could never emit`);
    }
  }
});

test('Gemini response schema exposes the decisive-group paragraph shape', async () => {
  const { responseSchema, responseSchemaEn } = await import('../pipeline/narrate.js');
  for (const schema of [responseSchema, responseSchemaEn]) {
    const groups = schema.properties.groups;
    assert.equal(groups.type, 'ARRAY');
    assert.deepEqual(groups.items.required, ['name', 'scenario']);
    assert.ok(!schema.required.includes('groups'), 'groups must stay optional (non-decisive nights omit it)');
  }
});

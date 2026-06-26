/**
 * Narration: turns verified match facts into Romanian voice via the Gemini API.
 * The model never receives authority over facts — scores, scorers, and tables
 * are provided as input and merged back verbatim in run.js.
 *
 * The voice prompt, output schema, and user-message builder live in
 * narration-core.js so the Claude engine competes on the identical contract.
 */

import { SYSTEM_PROMPT, SYSTEM_PROMPT_EN, narrationSchema, narrationSchemaEn, buildUserMessage, normalizeSteer } from './narration-core.js';

export { buildUserMessage, normalizeSteer };

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// Both rungs are GA model ids, pinned and versioned. Preview endpoints
// (gemini-*-flash-preview) have no SLA and were the worst-hit during the
// Google-side 503 "high demand" storms that dropped digests — and since Google
// counts failed 503s toward the daily quota, hammering a flapping preview also
// burned the free quota. gemini-3.5-flash is the newest GA Flash (punchy
// Romanian); gemini-2.5-flash is the older GA model kept as a distinct-endpoint
// safety net. Never a `-latest` alias: it 404s silently when Google rotates the
// model behind it.
export const DEFAULT_MODEL = 'gemini-3.5-flash';
export const FALLBACK_MODEL = 'gemini-2.5-flash';
// Attempt counts are deliberately modest: the digest workflow polls every 15 min
// with --require-complete, so that poll loop is the real outer retry. During a
// multi-hour Google 503 storm a run should fail FAST and let the next poll retry
// on a fresh window, rather than burn backoff (and quota) on a dead endpoint.
// gemini-polish makes 3 calls (draft/critique/rewrite) × RO+EN, so keeping the
// per-call attempts low bounds the worst case well under the poll cadence.
const PRIMARY_MAX_ATTEMPTS = 2;
const FALLBACK_MAX_ATTEMPTS = 2;
// Abort a stalled request so a hung socket on a flapping endpoint surfaces as a
// retryable error instead of blocking the whole nightly run forever.
const REQUEST_TIMEOUT_MS = 60_000;

// Gemini structured-output schema (OpenAPI subset) mirroring narrationSchema.
export const responseSchema = {
  type: 'OBJECT',
  required: ['headline', 'summary', 'matches', 'tonight'],
  properties: {
    headline: { type: 'STRING' },
    summary: { type: 'STRING' },
    matches: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['id', 'pill', 'drama'],
        properties: {
          id: { type: 'INTEGER' },
          pill: { type: 'STRING' },
          drama: { type: 'INTEGER' },
        },
      },
    },
    tonight: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['id', 'alarm', 'why'],
        properties: {
          id: { type: 'INTEGER' },
          alarm: { type: 'STRING', enum: ['merită văzut', 'citești dimineața'] },
          why: { type: 'STRING' },
        },
      },
    },
    // Decisive-matchday joint paragraphs. Declared (but not required) so Gemini can
    // emit one per group on a decisive night and omit the field entirely otherwise —
    // without this property Gemini's structured output cannot return groups at all.
    groups: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['name', 'scenario'],
        properties: {
          name: { type: 'STRING' },
          scenario: { type: 'STRING' },
        },
      },
    },
  },
};

// Gemini structured-output schema for English narration: identical to
// responseSchema but with the English alarm enum.
export const responseSchemaEn = {
  type: 'OBJECT',
  required: ['headline', 'summary', 'matches', 'tonight'],
  properties: {
    headline: { type: 'STRING' },
    summary: { type: 'STRING' },
    matches: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['id', 'pill', 'drama'],
        properties: {
          id: { type: 'INTEGER' },
          pill: { type: 'STRING' },
          drama: { type: 'INTEGER' },
        },
      },
    },
    tonight: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['id', 'alarm', 'why'],
        properties: {
          id: { type: 'INTEGER' },
          alarm: { type: 'STRING', enum: ['worth watching', 'catch it later'] },
          why: { type: 'STRING' },
        },
      },
    },
    // Decisive-matchday joint paragraphs. Declared (but not required) so Gemini can
    // emit one per group on a decisive night and omit the field entirely otherwise —
    // without this property Gemini's structured output cannot return groups at all.
    groups: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['name', 'scenario'],
        properties: {
          name: { type: 'STRING' },
          scenario: { type: 'STRING' },
        },
      },
    },
  },
};

/**
 * One Gemini call with an injectable system prompt and optional schema.
 * schema null → plain text response (used for the idiom critique); schema set →
 * structured JSON (validated by the caller). Aborts a stalled request so a hung
 * socket on a flapping endpoint becomes a retryable error.
 */
async function callGemini({ apiKey, model, systemPrompt, userMessage, schema }) {
  const generationConfig = { temperature: 0.8 };
  if (schema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = schema;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${GEMINI_BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    // AbortError (timeout) or a network drop — both transient, both retryable.
    const error = new Error(`Gemini request failed: ${err.name === 'AbortError' ? `timed out after ${REQUEST_TIMEOUT_MS / 1000}s` : err.message}`);
    error.retryable = true;
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Gemini API returned ${response.status}: ${body.slice(0, 500)}`);
    error.retryable = response.status === 429 || response.status >= 500;
    throw error;
  }
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini API returned no text candidate');
  }
  return text;
}

/** Exponential backoff with a 64s cap: 2s, 4s, 8s, 16s, 32s, 64s, 64s, ... */
function expBackoffMs(attempt) {
  return Math.min(2_000 * 2 ** attempt, 64_000);
}

/** Default sleep — overridable in tests to avoid real backoff waits. */
const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs one model to exhaustion: retries transient 429/5xx (and request
 * timeouts) with exponential backoff up to maxAttempts, plus one schema/JSON
 * retry on bad output. With a schema, returns the validated object; without,
 * the raw text. Throws the last error when the model never succeeds, so the
 * caller can fall back to another model.
 */
async function callModelWithBackoff({ apiKey, model, systemPrompt, userMessage, schema, validate, maxAttempts, sleep }) {
  let schemaRetryUsed = false;
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const text = await callGemini({ apiKey, model, systemPrompt, userMessage, schema });
      return validate ? validate(text) : text;
    } catch (error) {
      lastError = error;
      if (error.retryable && attempt < maxAttempts - 1) {
        const wait = expBackoffMs(attempt);
        console.warn(`Gemini ${model} error, backing off ${wait / 1000}s (attempt ${attempt + 1}/${maxAttempts})...`);
        await sleep(wait);
        continue;
      }
      const badOutput = error instanceof SyntaxError || error.name === 'ZodError';
      if (badOutput && !schemaRetryUsed) {
        schemaRetryUsed = true;
        continue;
      }
      break;
    }
  }
  throw lastError;
}

/**
 * Resilient Gemini call with the primary→fallback model ladder: exhausts the
 * preview primary (exponential backoff) before falling back to the stable GA
 * model. Injectable systemPrompt; schema null → plain text. This is the single
 * transport every Gemini path (single-pass narrate, draft, critique, rewrite)
 * goes through, so each gets the full ladder independently.
 */
export async function callGeminiResilient({ apiKey, model = DEFAULT_MODEL, systemPrompt, userMessage, schema = null, validateWith = narrationSchema, sleep = realSleep }) {
  // `schema` is the Gemini server-side response schema; when present the output is
  // a narration and is validated client-side against validateWith (defaults to
  // narrationSchema for RO callers; EN callers pass narrationSchemaEn). A null
  // schema means a plain-text call (the idiom critique), returned unvalidated.
  const validate = schema ? (text) => validateWith.parse(JSON.parse(text)) : null;
  try {
    return await callModelWithBackoff({ apiKey, model, systemPrompt, userMessage, schema, validate, maxAttempts: PRIMARY_MAX_ATTEMPTS, sleep });
  } catch (primaryError) {
    if (model === FALLBACK_MODEL) {
      throw new Error(`Gemini call failed after retries: ${primaryError}`);
    }
    console.warn(`Gemini ${model} exhausted (${primaryError.message}). Falling back to ${FALLBACK_MODEL}.`);
    try {
      return await callModelWithBackoff({ apiKey, model: FALLBACK_MODEL, systemPrompt, userMessage, schema, validate, maxAttempts: FALLBACK_MAX_ATTEMPTS, sleep });
    } catch (fallbackError) {
      throw new Error(`Gemini call failed on both ${model} and ${FALLBACK_MODEL}: ${fallbackError}`);
    }
  }
}

/**
 * @param facts - { date, finished, tonight, standings } from the pipeline
 * @param recentProse - prose lines from previous digests to avoid repeating
 * @returns validated narration { headline, summary, matches, tonight }
 *
 * Single-pass narration. Exhausts the primary model (exponential backoff) before
 * falling back to the stable GA model — the preview primary has no SLA and
 * 503-flaps under load. `sleep` is injectable so tests skip the real backoff waits.
 */
export async function narrate(facts, { apiKey, model = DEFAULT_MODEL, recentProse = [], steer = null, gold = [], sleep = realSleep } = {}) {
  const userMessage = buildUserMessage(facts, recentProse, steer, gold);
  return callGeminiResilient({ apiKey, model, systemPrompt: SYSTEM_PROMPT, userMessage, schema: responseSchema, sleep });
}

/**
 * Single-pass English narration. Same transport/ladder as narrate(), but with
 * the English voice prompt and English response schema.
 */
export async function narrateEn(facts, { apiKey, model = DEFAULT_MODEL, recentProse = [], steer = null, gold = [], sleep = realSleep } = {}) {
  const userMessage = buildUserMessage(facts, recentProse, steer, gold);
  return callGeminiResilient({
    apiKey, model, systemPrompt: SYSTEM_PROMPT_EN, userMessage,
    schema: responseSchemaEn, validateWith: narrationSchemaEn, sleep,
  });
}

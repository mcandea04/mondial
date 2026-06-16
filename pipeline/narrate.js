/**
 * Narration: turns verified match facts into Romanian voice via the Gemini API.
 * The model never receives authority over facts — scores, scorers, and tables
 * are provided as input and merged back verbatim in run.js.
 *
 * The voice prompt, output schema, and user-message builder live in
 * narration-core.js so the Claude engine competes on the identical contract.
 */

import { SYSTEM_PROMPT, narrationSchema, buildUserMessage, normalizeSteer } from './narration-core.js';

export { buildUserMessage, normalizeSteer };

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// Pro tiers (gemini-2.5/3.x-pro) return 429 on the free key. Among free models,
// gemini-3-flash-preview writes a far punchier, more specific Romanian than 2.5-flash.
const DEFAULT_MODEL = 'gemini-3-flash-preview';
// gemini-3-flash-preview is a preview endpoint with no SLA; under load it 503s
// or stalls. gemini-2.5-flash is the stable GA model — weaker prose, but not
// preview-throttled, so it is the safety net when the primary is down.
const FALLBACK_MODEL = 'gemini-2.5-flash';
// Attempt counts are deliberately modest: the digest workflow polls every 15 min
// with --require-complete, so that poll loop is the real outer retry. A run that
// can't reach Gemini should fail fast and let the next poll try again, not burn a
// whole 15-min window on one call. gemini-polish makes 3 calls (draft/critique/
// rewrite); these counts keep its worst case bounded well under the poll cadence.
const PRIMARY_MAX_ATTEMPTS = 4;
const FALLBACK_MAX_ATTEMPTS = 3;
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
          alarm: { type: 'STRING', enum: ['stai treaz', 'citești dimineața'] },
          why: { type: 'STRING' },
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
export async function callGeminiResilient({ apiKey, model = DEFAULT_MODEL, systemPrompt, userMessage, schema = null, sleep = realSleep }) {
  // `schema` is the Gemini server-side response schema; when present the output is
  // a narration and is validated client-side against narrationSchema. The two are
  // a pair (responseSchema mirrors narrationSchema), not independent — this is the
  // narration transport, not a general-purpose Gemini client. A null schema means
  // a plain-text call (the idiom critique), returned unvalidated.
  const validate = schema ? (text) => narrationSchema.parse(JSON.parse(text)) : null;
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

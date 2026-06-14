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

// Gemini structured-output schema (OpenAPI subset) mirroring narrationSchema.
const responseSchema = {
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

async function callGemini({ apiKey, model, userMessage }) {
  const response = await fetch(`${GEMINI_BASE}/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema,
        temperature: 0.8,
      },
    }),
  });
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

/**
 * @param facts - { date, finished, tonight, standings } from the pipeline
 * @param recentProse - prose lines from previous digests to avoid repeating
 * @returns validated narration { headline, summary, matches, tonight }
 */
export async function narrate(facts, { apiKey, model = DEFAULT_MODEL, recentProse = [], steer = null } = {}) {
  const userMessage = buildUserMessage(facts, recentProse, steer);

  // Up to 4 attempts: covers transient API errors (429/5xx, with backoff)
  // and one retry for a response that fails JSON parsing or the schema.
  const backoffMs = [20_000, 60_000, 120_000];
  let schemaRetryUsed = false;
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const text = await callGemini({ apiKey, model, userMessage });
      return narrationSchema.parse(JSON.parse(text));
    } catch (error) {
      lastError = error;
      if (error.retryable && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs[attempt]));
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
  throw new Error(`Narration failed after retries: ${lastError}`);
}

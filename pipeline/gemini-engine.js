/**
 * Gemini narration engines for the idiom-polish pipeline (draft -> critique ->
 * rewrite). They share the resilient transport in narrate.js (primary -> GA
 * fallback ladder, request timeout) and present the same { model, userMessage,
 * systemPrompt } -> result contract polishedNarration expects, so the Claude and
 * Gemini polish paths are interchangeable.
 *
 * The model never gets authority over facts: the draft/rewrite are merged back
 * by id in run.js, the critique only steers phrasing.
 */

import { callGeminiResilient, responseSchema, responseSchemaEn } from './narrate.js';
import { narrationSchemaEn } from './narration-core.js';

function requireKey() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  return apiKey;
}

/**
 * Draft/rewrite engine: a schema-validated Gemini call. Returns the validated
 * narration object. `model` is the Gemini model id; defaults to the resilient
 * caller's primary when undefined.
 */
export async function callGeminiNarration({ model, userMessage, systemPrompt }) {
  return callGeminiResilient({
    apiKey: requireKey(),
    model: model || undefined,
    systemPrompt,
    userMessage,
    schema: responseSchema,
  });
}

/**
 * Critique engine: a plain-text Gemini call (no schema). Returns the reviewer's
 * idiom notes verbatim, to be injected into the rewrite system prompt.
 * Language-neutral — reused for both RO and EN polish critiques.
 */
export async function callGeminiText({ model, userMessage, systemPrompt }) {
  return callGeminiResilient({
    apiKey: requireKey(),
    model: model || undefined,
    systemPrompt,
    userMessage,
    schema: null,
  });
}

/**
 * EN draft/rewrite engine: schema-validated Gemini call using the English
 * response schema and Zod validator.
 */
export async function callGeminiNarrationEn({ model, userMessage, systemPrompt }) {
  return callGeminiResilient({
    apiKey: requireKey(),
    model: model || undefined,
    systemPrompt,
    userMessage,
    schema: responseSchemaEn,
    validateWith: narrationSchemaEn,
  });
}

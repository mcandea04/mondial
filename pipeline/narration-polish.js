/**
 * Idiom-polished narration: draft -> native idiom critique -> rewrite.
 *
 * The draft is the same single-pass Opus call production uses. A reviewer pass
 * flags only calques and unnatural phrasing (never facts, never the jokes), and
 * a rewrite applies the notes. If the critique or rewrite fails for any reason,
 * the validated draft ships — polish is a bonus, never a blocker, so a critique
 * hiccup never costs an otherwise-good morning. A draft failure propagates so
 * run.js can fall back to Gemini.
 */

import { callClaude, callClaudeText } from './claude-engine.js';
import {
  SYSTEM_PROMPT,
  CRITIQUE_SYSTEM_PROMPT,
  buildRewriteSystemPrompt,
  narrationToReviewText,
} from './narration-core.js';

/**
 * @returns { narration, polished } — polished is true only when the rewrite
 * succeeded. The prompt trio (draft system prompt, critique prompt, rewrite
 * builder) defaults to the Romanian set; the EN pass injects the English trio.
 */
export async function polishedNarration({
  model, userMessage,
  draftEngine = callClaude,
  critiqueEngine = callClaudeText,
  systemPrompt = SYSTEM_PROMPT,
  critiquePrompt = CRITIQUE_SYSTEM_PROMPT,
  buildRewritePrompt = buildRewriteSystemPrompt,
}) {
  // The draft await is intentionally OUTSIDE the try: a draft failure must
  // propagate so getNarration can fall back to Gemini. Only polish-stage
  // failures are swallowed (the draft is already shippable). Do not wrap this.
  const draft = await draftEngine({ model, userMessage, systemPrompt });
  let stage = 'critique';
  try {
    const critique = await critiqueEngine({
      model,
      userMessage: narrationToReviewText(draft),
      systemPrompt: critiquePrompt,
    });
    if (!critique.trim()) return { narration: draft, polished: false };

    stage = 'rewrite';
    const narration = await draftEngine({
      model,
      userMessage,
      systemPrompt: buildRewritePrompt(critique),
    });
    return { narration, polished: true };
  } catch (error) {
    console.warn(`Idiom polish failed at ${stage} (${error.message}). Shipping the unpolished draft.`);
    return { narration: draft, polished: false };
  }
}

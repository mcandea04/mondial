/**
 * Idiom-polished narration: draft -> native-Romanian idiom critique -> rewrite.
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
 * succeeded, so run.js can mark the digest "opus-polish" vs a degraded "opus".
 */
export async function polishedNarration({ model, userMessage, draftEngine = callClaude, critiqueEngine = callClaudeText }) {
  // The draft await is intentionally OUTSIDE the try: a draft failure must
  // propagate so getNarration can fall back to Gemini. Only polish-stage
  // failures are swallowed (the draft is already shippable). Do not wrap this.
  const draft = await draftEngine({ model, userMessage, systemPrompt: SYSTEM_PROMPT });
  let stage = 'critique';
  try {
    const critique = await critiqueEngine({
      model,
      userMessage: narrationToReviewText(draft),
      systemPrompt: CRITIQUE_SYSTEM_PROMPT,
    });
    // An empty critique means the reviewer found nothing to fix: ship the draft
    // rather than burn a rewrite call on empty guidance.
    if (!critique.trim()) return { narration: draft, polished: false };

    // The rewrite gets the ORIGINAL userMessage (the facts), not the review
    // text, so it re-derives from facts and stays keyed by id — the critique
    // only steers phrasing, it can never originate a score or scorer.
    stage = 'rewrite';
    const narration = await draftEngine({
      model,
      userMessage,
      systemPrompt: buildRewriteSystemPrompt(critique),
    });
    return { narration, polished: true };
  } catch (error) {
    console.warn(`Idiom polish failed at ${stage} (${error.message}). Shipping the unpolished draft.`);
    return { narration: draft, polished: false };
  }
}

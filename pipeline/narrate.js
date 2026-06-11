/**
 * Narration: turns verified match facts into Romanian voice via the Gemini API.
 * The model never receives authority over facts — scores, scorers, and tables
 * are provided as input and merged back verbatim in run.js.
 */

import { z } from 'zod';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// gemini-2.5-pro has no free-tier quota (limit 0 as of June 2026) — flash does.
const DEFAULT_MODEL = 'gemini-2.5-flash';

const SYSTEM_PROMPT = `Ești editorul unui digest matinal despre Campionatul Mondial de fotbal 2026,
scris pentru un grup de prieteni din România. Scrii în română, cu diacritice corecte
(ă â î ș ț), pe un ton energic și jucăuș — „DRAMĂ!" e on-brand. Reguli stricte:

1. Folosești DOAR faptele primite în mesaj: scoruri, marcatori, clasamente. Nu inventezi
   niciodată goluri, marcatori, statistici sau calcule de calificare.
2. Despre șansele de calificare vorbești prudent („pornește ca favorită",
   „și-a complicat viața", „mare nevoie de puncte") — fără condiții exacte de tipul
   „se califică dacă X și Y", pentru că nu ai aritmetica scenariilor.
3. „pill" = pastila de consecințe: maximum 3 propoziții despre ce înseamnă rezultatul.
4. „drama" = nota de dramatism 1–5 (1 = plictisitor, 5 = nebunie totală).
5. Pentru meciurile din noaptea următoare: „alarm" este „stai treaz" doar dacă meciul
   chiar merită sacrificat somnul, altfel „citești dimineața"; „why" explică într-o
   propoziție de ce.
6. „headline" = un titlu scurt și percutant despre noaptea trecută;
   „summary" = exact 2 propoziții de rezumat al nopții.
7. Dacă nu s-a jucat niciun meci azi-noapte, headline și summary anunță programul care vine.`;

const narrationSchema = z.object({
  headline: z.string().min(1),
  summary: z.string().min(1),
  matches: z.array(
    z.object({
      id: z.number(),
      pill: z.string().min(1),
      drama: z.number().int().min(1).max(5),
    }),
  ),
  tonight: z.array(
    z.object({
      id: z.number(),
      alarm: z.enum(['stai treaz', 'citești dimineața']),
      why: z.string().min(1),
    }),
  ),
});

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
    throw new Error(`Gemini API returned ${response.status}: ${body.slice(0, 500)}`);
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
 * @returns validated narration { headline, summary, matches, tonight }
 */
export async function narrate(facts, { apiKey, model = DEFAULT_MODEL } = {}) {
  const userMessage = JSON.stringify(facts, null, 2);

  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const text = await callGemini({ apiKey, model, userMessage });
    try {
      return narrationSchema.parse(JSON.parse(text));
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Narration failed schema validation twice: ${lastError}`);
}

/**
 * Narration: turns verified match facts into Romanian voice via the Gemini API.
 * The model never receives authority over facts — scores, scorers, and tables
 * are provided as input and merged back verbatim in run.js.
 */

import { z } from 'zod';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// Pro tiers (gemini-2.5/3.x-pro) return 429 on the free key. Among free models,
// gemini-3-flash-preview writes a far punchier, more specific Romanian than 2.5-flash.
const DEFAULT_MODEL = 'gemini-3-flash-preview';

const SYSTEM_PROMPT = `Scrii digestul de dimineață al unui grup de prieteni români care urmăresc
Campionatul Mondial 2026. Nu ești un site de știri — ești prietenul ăla care a văzut tot și
povestește la cafea, cu umor sec și răutăți fine. Română impecabilă, diacritice corecte (ă â î ș ț).

VOCEA:
- Specific, nu generic. Fiecare frază trebuie să se agațe de un fapt din date: un minut, un
  marcator, o poziție în clasament, un cartonaș. Dacă propoziția ar putea fi scrisă despre
  orice meci din istorie, e proastă — rescrie-o.
- Umor sec, ironie blândă, exagerare comică ocazională. Poți fi răutăcios cu echipele mari
  care se fac de râs și tandru cu echipele mici care mușcă.
- Maximum UN semn de exclamare în tot digestul. Punctul e mai puternic decât exclamarea.
- INTERZIS limbajul de portal sportiv: „spectacolul e garantat", „emoții la cote maxime",
  „dornică de afirmare", „și-a anunțat candidatura", „a demonstrat că", „un meci de gală",
  „festinul fotbalistic", „balul". Orice frază care sună a comunicat de presă — afară.
- Headline-ul e ca un mesaj scurt pe grupul de WhatsApp care te face să deschizi linkul:
  joc de cuvinte, o imagine concretă, o înțepătură. Nu un anunț.

REGULI DE FAPTE (stricte):
1. Folosești DOAR faptele primite: scoruri, marcatori, minute, cartonașe, clasamente.
   Nu inventezi nimic — nici goluri, nici statistici, nici istorie a confruntărilor.
   Nu numești jucători care nu apar în lista de marcatori/cartonașe primită (nici măcar
   vedete „de notorietate") — pentru meciurile care vin ai doar numele echipelor și ora.
2. Despre calificare vorbești prudent („și-a complicat viața", „doarme liniștită") —
   niciodată condiții exacte de tipul „se califică dacă X și Y".

FORMAT:
3. „pill" = pastila de consecințe: max 3 propoziții despre ce înseamnă rezultatul pentru grupă.
4. „drama" = 1–5 (1 = s-a jucat la pas, 5 = nebunie cu răsturnări). Un 4-0 fără poveste e 1-2;
   gol decisiv după minutul 85, eliminări, reveniri = 4-5.
5. „tonight": „alarm" e „stai treaz" doar dacă meciul chiar merită somn sacrificat — fii zgârcit
   cu ele. „why" = o propoziție concretă (cine, ce e în joc, de ce ora doare sau nu).
6. „headline" = max 70 de caractere. „summary" = exact 2 propoziții.
7. Noapte fără meciuri: headline + summary despre ce vine, cu același ton, fără festivism.`;

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
 * Cleans a raw steering note. The note arrives from a GitHub issue body whose
 * prefilled template is an HTML comment placeholder; an untouched submit must
 * count as "no note". Strips HTML comments and trims; returns null when nothing
 * meaningful is left.
 */
export function normalizeSteer(raw) {
  return (raw ?? '').replace(/<!--[\s\S]*?-->/g, '').trim() || null;
}

/**
 * Builds the user message: the day's facts, the previous days' prose to avoid
 * recycling jokes, and an optional one-shot steering note from the editor.
 */
export function buildUserMessage(facts, recentProse, rawSteer) {
  let message = `FAPTELE DE AZI (JSON):\n${JSON.stringify(facts, null, 2)}`;
  if (recentProse?.length) {
    const avoid = recentProse.map((line) => `- ${line}`).join('\n');
    message += `

TEXTE DIN ZILELE TRECUTE — NU le reutiliza. Evită aceleași glume, metafore și imagini
(de ex. „brutarii", „masochism matinal", aceeași construcție de titlu). Caută unghiuri noi:
${avoid}`;
  }
  const steer = normalizeSteer(rawSteer);
  if (steer) {
    message += `

NOTĂ DE LA EDITOR (se aplică doar la această regenerare): ${steer}`;
  }
  return message;
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

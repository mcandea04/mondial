# English localization + language toggle (issue #10)

## Goal

Make the whole site readable in English as well as Romanian: both the static UI
chrome (labels, headers, table columns) and the model-written narration
(headline, summary, per-match pills, tonight reasons, teaser). A header toggle
switches language; the choice persists in `localStorage`. Default stays Romanian
— the audience is a group of Romanian friends, English is the secondary read.

## Core principle (unchanged)

**Code owns facts, the model writes the drama.** English does not weaken this.
EN narration is generated from the *same* facts JSON the RO call uses, and its
output is keyed back to facts by match `id` and merged verbatim in `run.js`. The
EN model contributes only `headline`/`summary`/`pill`/`drama`/`alarm`/`why` —
never a score, scorer, minute, card, or standings value. Facts are stored once,
never duplicated per language.

## Decisions

- **Scope:** UI chrome *and* narration.
- **Toggle:** a button next to the theme toggle; choice saved in `localStorage`
  under key `lang`; default `ro`; no browser auto-detect.
- **Data shape:** one JSON per day; prose fields become per-language objects
  (`{ ro, en }`); facts stay flat and single-language.
- **EN prose:** native English generation — a parallel English voice
  system-prompt grounded in the same facts (not a RO→EN translation).
- **EN engine:** the same engine as RO (whatever `NARRATOR` is set to).
- **EN failure:** ship RO-only; the morning is never blocked by an EN-engine
  problem (mirrors the existing Opus→Gemini fallback philosophy).
- **EN timing:** sequential, after the RO narration completes.
- **Legacy archive days:** backfilled with EN via a one-time migration that only
  *adds* `en` fields and never touches existing RO prose.
- **Status badges:** translated at render time via a static RO→EN map in
  `render.js` (a closed 4-value enum; not duplicated into the facts layer).
- **OG image / social preview:** unchanged — single-instance, Romanian. No
  per-language OG work.

## Data shape

Prose fields that today are plain strings become `{ ro, en }` objects. Facts are
untouched. `drama` stays a scalar (language-neutral). `narrator` becomes a
per-language object so the JSON records which engine wrote each language (an
EN-fallback day has `en` absent / null).

```jsonc
{
  "date": "2026-06-17",
  "factsHash": "...",
  "narrator": { "ro": "gemini-polish", "en": "gemini-polish" },
  "headline": { "ro": "...", "en": "..." },
  "summary":  { "ro": "...", "en": "..." },
  "matches": [
    {
      "id": 1234,
      "home": "...", "away": "...", "score": [2, 1],
      "scorers": [...], "events": [...], "stats": {...},
      "homeCode": "...", "awayCode": "...",
      "highlight": "...",
      "drama": 4,
      "pill": { "ro": "...", "en": "..." }
    }
  ],
  "groups": [ /* standings facts, status is a single RO enum value */ ],
  "tonight": [
    {
      "id": 5678,
      "home": "...", "away": "...",
      "homeCode": "...", "awayCode": "...",
      "kickoffEEST": "21:00",
      "alarm": { "ro": "stai treaz", "en": "stay up" },
      "why":   { "ro": "...", "en": "..." }
    }
  ],
  "teaser": { "ro": "...", "en": "..." }
}
```

### `alarm` enum

RO: `stai treaz` / `citești dimineața`. EN needs its own enum: `stay up` /
`read in the morning`. The EN narration schema validates the EN enum. The badge
CSS class is chosen by render.js from the *active-language* alarm value, so
render maps both enums to the same two classes (`badge-ok` for "watch tonight",
`badge-muted` otherwise) — see Rendering.

### Backward compatibility

Existing committed day JSONs store flat strings (`headline: "..."`). After the
backfill they will carry `{ ro, en }`, but render.js must tolerate both shapes
regardless (a day that predates backfill, or an EN-fallback day with no `en`).
A single helper normalizes on read:

```js
// string  -> RO-only legacy passthrough
// object  -> per-language; fall back ro -> first available
function localize(field, lang) {
  if (field == null) return '';
  if (typeof field === 'string') return field;     // legacy RO-only
  return field[lang] ?? field.ro ?? '';
}
```

## Pipeline changes

### Narration core (`narration-core.js`)

- Add an English voice system prompt, `SYSTEM_PROMPT_EN`, carrying the same
  intent as the Romanian one (specific-not-generic, dry humor, anti-press-portal
  rules, fact-strictness, the two-step `tonight` reasoning) but written for
  natural English football idiom — not a line-by-line translation of the RO
  prompt. The RO clichés list is replaced by the English equivalents
  ("a thrilling encounter", "made their intentions clear", etc.).
- Add an EN narration schema `narrationSchemaEn` (identical structure, EN alarm
  enum) and its Gemini server-side mirror `responseSchemaEn`.
- `buildUserMessage` is reused unchanged — it serializes facts + recent prose +
  gold; both languages eat the same facts. (Gold few-shot and recent-prose
  avoidance stay Romanian-only for now; EN gets facts + an EN voice prompt. EN
  recent-prose avoidance is a possible follow-up, not in scope.)

### Engine selection (`run.js` `getNarration`)

- After producing the RO narration (current logic, unchanged), run the same
  engine again for EN with the EN system prompt + EN schema.
- Wrap the EN call in its own try/catch: on any EN failure log a warning and
  return EN absent. The RO narration always ships.
- Return shape grows to carry both: `{ ro: {narration, narrator}, en: {narration, narrator} | null }`.

### Digest assembly (`run.js` `main`)

- Build prose fields as `{ ro, en }` objects, reading EN from the EN narration
  keyed by the same `id`. When EN is absent, omit the `en` key (render falls
  back to RO).
- `narrator` becomes `{ ro, en }` (en omitted on fallback).
- `teaser`: build both, RO via existing `buildTeaser`, EN via an English string
  variant.
- Facts merge (score/scorers/events/stats/standings/highlight) is unchanged.
- The freeze (`factsHash`) and reuse path must reuse *both* languages when facts
  are unchanged — `reuseNarration` extended to carry the per-language prose
  through. A reused day keeps its stored `narrator` object.

### Freeze / reuse interaction

`factsHash` is computed from facts only (already language-neutral), so it does
not change. When facts are unchanged the stored bilingual prose is reused
wholesale. `--re-narrate` regenerates both languages.

## Backfill migration (one-time script)

`pipeline/backfill-en.js` (run manually, like the highlights backfill):

- For each committed `site/data/YYYY-MM-DD.json`, skip if `headline.en` already
  present (idempotent, re-runnable).
- Reconstruct `factsForNarration` from the stored facts already in the file
  (score, scorers, events, stats, standings/groups, tonight, date). Handles
  empty-match nights (`matches: []`).
- Call the EN narration (same engine ladder) and merge only `en` fields into the
  existing prose objects; convert any flat RO string into `{ ro, en }`.
- **Never** alter existing RO prose (gold-promoted lines stay intact).
- Rebuild `latest.json` if it points at a backfilled day. Leave `manifest.json`
  untouched (no schema change there).

## Site / rendering

### Language module (`site/assets/lang.js`)

Mirrors `theme.js`:

- `LANG_KEY = 'lang'`, `currentLang()` → saved `'ro'|'en'` else `'ro'`.
- `mountLangToggle(container, onChange)` adds a button (e.g. `RO`/`EN` text)
  beside the theme toggle; click flips, persists, calls `onChange(newLang)`,
  and sets `document.documentElement.lang`.
- Idempotent like `mountToggle`.

### `render.js`

- `renderDigest(root, digest, lang)` gains a `lang` arg (default `currentLang()`).
- All hardcoded Romanian UI strings move into a `UI_STRINGS[lang]` dictionary:
  meta line "azi-noapte la Mondial", match-count labels, "La noapte — merită
  alarma?", "Grupa", table headers (Echipă/MJ/GD/Pct/Status), "▶ Rezumat",
  "Share ↗", empty-state text, and the date formatter locale
  (`ro-RO` → `en-GB`).
- Prose fields read through `localize(field, lang)`.
- Status badge label translated via `STATUS_LABEL[lang][status]` (a static map);
  the badge CSS class keeps keying off the canonical RO status value (the fact).
- The tonight alarm badge class is chosen from the active-language alarm value
  via a small `alarmIsWatch(value)` predicate that recognizes both enums.
- The share button uses `localize(digest.teaser, lang)`.

### Pages

- `index.html` and `arhiva.html` both mount the lang toggle and re-render the
  current digest on language change. `index.html` sets `<html lang>` from the
  saved choice in the inline head script (like the theme bootstrap) to avoid a
  flash.

## Testing

- `narration-core`: EN schema validates the EN alarm enum; RO schema unchanged.
- `run.js`: per-language assembly produces `{ ro, en }`; EN-failure path ships
  RO-only with `en` absent and `narrator.en` absent; reuse path carries both
  languages; `--re-narrate` regenerates both.
- `render.js`: `localize` handles legacy string, full object, and `en`-missing
  object; `UI_STRINGS` covers every rendered label in both languages; alarm
  badge class correct for both enums; status label map covers all four statuses.
- backfill script: idempotency (skip days with `en`), RO preservation, empty-night
  handling.
- Fixtures: add an EN narration fixture so offline `--fixtures` runs exercise the
  bilingual path; existing RO fixture stays.

## Out of scope (YAGNI)

- Per-language OG images / social preview routing.
- Browser language auto-detection.
- EN recent-prose avoidance and EN gold few-shot (RO-only stays; revisit if EN
  prose recycles jokes).
- A third language or any general i18n framework — two languages, hand-kept dicts.

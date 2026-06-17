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
      "alarm": { "ro": "merită văzut", "en": "stay up" },
      "why":   { "ro": "...", "en": "..." }
    }
  ],
  "teaser": { "ro": "...", "en": "..." }
}
```

### `alarm` enum

**Real RO enum (verified in code):** `merită văzut` / `citești dimineața`
(`narration-core.js`, `run.js` default, `render.js`). The earlier draft of this
spec wrongly said `stai treaz`; that token only appears in older committed
archive days (those before the enum settled) — a pre-existing inconsistency. Current
`render.js` colors only `merită văzut` as "watch", so those legacy days silently
render muted (latent bug we fix in passing).

EN needs its own enum: `stay up` / `read in the morning`. The EN narration
schema validates the EN enum. The badge CSS class is chosen by render.js from the
*active-language* alarm value via a single predicate:

```js
// watch-tonight tokens across both languages + the legacy RO value
const WATCH_ALARMS = new Set(['merită văzut', 'stai treaz', 'stay up']);
const alarmIsWatch = (value) => WATCH_ALARMS.has(value); // badge-ok else badge-muted
```

This both drives the EN badge and repairs the legacy `stai treaz` archive days.

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

### Polish ladder must be language-parameterized

`polishedNarration` currently imports and hardcodes the RO `SYSTEM_PROMPT`,
`CRITIQUE_SYSTEM_PROMPT`, and `buildRewriteSystemPrompt` (a Romanian-native idiom
reviewer). Running that critique over English is nonsensical. So:

- Add `CRITIQUE_SYSTEM_PROMPT_EN` (an English-native idiom reviewer) and
  `buildRewriteSystemPromptEn` (EN voice prompt + the EN critique notes).
- `polishedNarration` takes the draft system prompt, critique system prompt, and
  rewrite-prompt builder as parameters (defaulting to the RO trio for backward
  compatibility), so the EN pass injects the EN trio. `narrationToReviewText`
  is language-neutral (it flattens fields) and is reused.

### Engine selection (`run.js` `getNarration`)

- After producing the RO narration (current logic, unchanged), run the same
  engine again for EN with the EN system/critique/rewrite prompts + EN schema.
- Wrap the EN call in its own try/catch: on any EN failure log a warning and
  return EN absent. The RO narration always ships.
- Return shape grows to carry both:
  `{ ro: { narration, narrator }, en: { narration, narrator } | null }`.
  **This is a breaking change** to `main()`'s `({ narration, narrator } = ...)`
  destructure and to ~10 destructure sites in `test/narrator-select.test.js`;
  rewriting those tests is in scope.
- `getNarration`'s EN branch still goes through the fallback ladder, but an EN
  *total* failure returns `en: null` (not a `gemini-fallback` marker) — EN is
  best-effort. A successful EN via the Opus→Gemini fallback records its real
  engine in `narrator.en` just as RO does.

### Digest assembly (`run.js` `main`)

The single most error-prone area: today `main()` reads the narration prose as
flat strings in many places, and several of them must KEEP reading a flat RO
string even after the stored digest prose becomes `{ ro, en }`. The rule:

- **A `roNarration` object (flat `{headline, summary, matches, tonight}`) stays
  the variable that feeds OG, teaser, email, and the OG meta injection.** Those
  are Romanian-only by decision, so they read `roNarration.headline` /
  `roNarration.summary` — never the `{ro,en}` digest field. This prevents the
  `[object Object]` leak that would otherwise hit `renderOgImage`,
  `injectOgTags`, `buildTeaser`, and `setOutput('headline'/'summary')`.
- **Only the stored digest's prose fields become `{ ro, en }`:** `headline`,
  `summary`, each `matches[].pill`, each `tonight[].alarm` + `.why`, `teaser`.
  EN values come from the EN narration keyed by the same `id`. When EN is absent,
  omit the `en` key (render falls back to RO via `localize`).
- `drama` stays scalar (from RO narration; language-neutral).
- `narrator` becomes `{ ro, en }`. `setOutput('narrator', ...)` and the email
  read `narrator.ro` (a string) — never the object.
- `teaser`: `teaser.ro` via existing `buildTeaser`; `teaser.en` via a new EN
  variant (own pluralization: `1 match` / `N matches`, `no matches overnight`),
  built only when EN narration succeeded, else `teaser.en` omitted.
- Facts merge (score/scorers/events/stats/standings/highlight) is unchanged.

### `recentProseBefore` + gold filtering (existing RO feature — must not regress)

`recentProseBefore` and `withoutGold` read `digest.headline/summary`, `m.pill`,
`t.why` as strings to build the RO anti-recycling avoid-list. Once prior days
carry `{ ro, en }`, these would push objects (serialized as `[object Object]`)
and gold filtering (string compare) would silently stop matching. Fix:
`recentProseBefore` localizes each field to `.ro` with legacy-string passthrough
(reuse the same `localize` helper, server-side copy). EN recent-prose avoidance
stays out of scope.

### Freeze / reuse interaction

`factsHash` is computed from facts only (language-neutral), so it does not
change. `reuseNarration` is extended to carry per-language prose: **RO fields
stay required** (a missing RO `pill`/`why`/`headline` still returns `null` →
re-narrate), but **`en` is optional** — a stored day with no `en` reuses RO-only
and does NOT force a re-narrate (that would defeat the freeze on every poll).
`main()` consumes the reuse result and the fresh `getNarration` result through
one shared assembly that emits the `{ro,en}` digest, treating absent EN as
"omit the `en` key".

**Consequence (accepted):** a day that froze RO-only (because it published before
the EN code deployed, or because EN failed that night) is NOT self-healed by the
nightly reuse path — it stays RO-only until the backfill script touches it or
`--re-narrate` is forced. This is the same best-effort contract as the existing
Opus→Gemini degrade. The backfill (below) is the transition-window heal; new
days from deploy onward get both languages on their first publish (no stored
digest yet → not reused). `--re-narrate` regenerates both languages.

### Publish gate / email interaction

- The publish-only-on-change byte compare (`run.js`) keeps working: a backfilled
  or first-bilingual day differs byte-wise and deploys; a frozen RO-only reused
  day is byte-identical and correctly does not re-publish. Because reuse does NOT
  top-up EN live, there is no per-poll EN flap that could re-deploy a frozen day.
- `narrationChanged` (email trigger) stays RO-centric and boolean (`!reused`).
  The notification email is for the Romanian audience; it fires when fresh prose
  is generated, not when EN is merely backfilled later. Documented, not changed.

## Backfill migration (one-time script)

`pipeline/backfill-en.js` (run manually, like the highlights backfill):

- For each committed `site/data/YYYY-MM-DD.json`, skip if `headline.en` already
  present (idempotent, re-runnable).
- Reconstruct `factsForNarration` from the stored facts already in the file
  (score, scorers, events, stats, groups, tonight, date). Handles empty-match
  nights (`matches: []`).
- **Known limitation (accepted):** the stored day JSON does NOT carry
  `homeRank`/`awayRank` (they were only inputs to the live run) and stores
  standings as the classified `groups`, not the raw `standings`. So backfilled EN
  `tonight` reasoning runs with ranks absent — the EN prompt's "if rank is null,
  don't invent a hierarchy" branch handles this; the historical EN tonight prose
  is slightly weaker than a live run would have produced. Not worth re-fetching
  ESPN for ephemeral past "tonight" sections.
- Call the EN narration (same engine ladder + EN prompts) and merge only `en`
  fields into the existing prose objects; convert any flat RO string into
  `{ ro, en }`. Also write `narrator` as `{ ro: <existing>, en: <engine> }`.
- **Never** alter existing RO prose (gold-promoted lines stay intact).
- Rebuild `latest.json` if it points at a backfilled day. Leave `manifest.json`
  untouched (no schema change there).

### Deploy ordering (mandatory)

`render.js` is made tolerant of both shapes (legacy flat string and `{ro,en}`),
so the only safe sequence is **code-first**:

1. Merge + deploy the new `render.js`/`lang.js`/pipeline code (Pages redeploy).
   Old archive days (flat strings) keep rendering correctly under `localize`.
2. Then run `backfill-en.js` locally and commit the updated `site/data/*.json`.
3. Deploy the backfilled data via a manual `deploy.yml` dispatch (no
   re-narration, preserves the committed prose).

Backfilling data BEFORE the new render.js is live would make the running
(old) render show `[object Object]`, so this order is not optional.

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

- `index.html` and `arhiva.html` both mount the lang toggle and re-render on
  language change. Each page needs a **state holder** so "re-render the current
  digest" has something to re-render:
  - `index.html`: hoist the loaded `digest` to module scope; `onChange(lang)`
    calls `renderDigest(app, digest, lang)`.
  - `arhiva.html`: track the currently shown date (it already lives in
    `location.hash`); `onChange(lang)` re-runs `showDay(currentDate, lang)`, or
    is a no-op when no day is open (only the list is shown).
- Both pages set `<html lang>` from the saved choice in an inline head script
  mirroring `currentLang()` (`localStorage.lang || 'ro'`) to avoid a flash. The
  static OG meta stays Romanian regardless (social preview is RO by decision), so
  an EN reader's crawler still sees RO — accepted.

### Partial EN (accepted behavior)

The EN narration is one schema-validated object, so it can't have a half-missing
field — but it MAY omit a `matches[]`/`tonight[]` entry for some `id` (the schema
doesn't require every fact id). In that case `localize(field, 'en')` falls back
to the RO value for that one pill/why inside an otherwise-English page. Accepted;
no per-item marker.

## Testing

- `narration-core`: EN schema validates the EN alarm enum; RO schema unchanged.
- `run.js` / `narrator-select.test.js`: the existing ~10 destructure sites are
  rewritten for the new `{ ro, en }` `getNarration` shape. Per-language assembly
  produces `{ ro, en }` digest prose; EN-failure path ships RO-only with `en`
  absent and `narrator.en` absent; OG/teaser/email read the flat RO value (no
  `[object Object]`); reuse path keeps RO required + EN optional; `--re-narrate`
  regenerates both.
- `polishedNarration`: EN trio (system/critique/rewrite) is injected and used;
  RO defaults unchanged.
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

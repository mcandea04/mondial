# UI polish — segmented controls, compact drama, inline highlights

Issue #14. Branch: `worktree-english-localization` (builds on the RO/EN localization work).

## Goal

Tidy the chrome and the match card so they take less vertical and horizontal space
and read more clearly, without a redesign. Four concrete changes, all "light touch":
keep the warm palette and the system font, only restyle the named controls.

1. **Language toggle** — replace the single button that shows the *target* language
   with a segmented `[RO | EN]` pill: both values always visible, the active one filled.
2. **Theme toggle** — replace the single sun/moon button with a matching segmented
   `[☀ | ☾]` pill so the two controls in the topbar look like a set.
3. **Drama rating** — replace the row of up to five 🔥 with a single colored thermal
   face whose hue rises blue→red with the rating.
4. **Highlights** — replace the full-width solid block link with an icon-only ▷ play
   button inline in the match header, after the drama face.

Out of scope: palette rework, web fonts, copy changes, any pipeline/narration change.

## Current state

- `site/assets/lang.js` — `mountLangToggle(container, onChange)` builds one `.lang-toggle`
  button whose text is the language you'd switch *to* (`EN` when RO is active).
  `currentLang()` reads `localStorage.lang`, default `'ro'`.
- `site/assets/theme.js` — `mountToggle(container)` builds one `.theme-toggle` button
  with a ☀️/🌙 emoji. `currentTheme()` reads `localStorage.theme`, falls back to
  `prefers-color-scheme`. It also listens for OS theme changes and re-syncs when the
  user has made no explicit choice.
- `site/index.html` mounts both into `#topbar`; `site/arhiva.html` mounts both into `.meta`.
- `site/assets/render.js` — `renderMatchCard` builds `.flames` (a `<div>` with N `.flame`
  spans, each `🔥` via `::before`) in the match header, and a separate full-width
  `.highlight` anchor appended to the card body when `match.highlight` is set.
- Drama scale: `match.drama` is an integer **1–5** set by the model. The data scale does
  not change — only its rendering does.

## Design

### Segmented controls (lang + theme)

Both controls become the same shape: a rounded track holding two segments; the active
segment is a filled dark pill, the inactive one is muted text. This is the EN/JA reference
pattern, RO-first.

```
            [ RO | EN ]   [ ☀ | ☾ ]
              ^ active       ^ active
```

A single shared builder keeps the two controls identical and avoids duplicating the
DOM/markup logic. Add to a small shared module (new `site/assets/segmented.js`):

    // options: [{ value, label, title }], active: current value,
    // onSelect(value) called only when the choice actually changes.
    export function mountSegmented(container, className, options, getActive, onSelect)

- Renders a `<div class="segmented {className}" role="group">` with one
  `<button role="radio">` per option. The active button gets `aria-checked="true"`
  and the `.is-active` class; others `aria-checked="false"`.
- Clicking an inactive segment calls `onSelect(value)`; clicking the active one is a no-op.
- Idempotent per container+className (a second mount is a no-op), matching today's guards.
- A `sync()` closure re-reads `getActive()` and repaints the active state, so external
  changes (OS theme flip) can re-sync without rebuilding.

`lang.js` and `theme.js` keep their public functions (`mountLangToggle`,
`mountToggle`) and their storage/`currentLang`/`currentTheme` logic — they are rewritten
to delegate their DOM to `mountSegmented`:

- `mountLangToggle(container, onChange)` → segmented `[RO|EN]`, RO first. On select:
  persist `localStorage.lang`, set `document.documentElement.lang`, call `onChange(lang)`.
- `mountToggle(container)` → segmented `[☀|☾]`. On select: persist `localStorage.theme`,
  set `document.documentElement.dataset.theme`. The existing `matchMedia('change')`
  listener stays and calls the control's `sync()` when no explicit choice is stored.

Titles for accessibility: lang segments `title`/`aria-label` "Română"/"English"; theme
segments "Temă luminoasă"/"Temă întunecată". The group keeps a label
("Schimbă limba / Change language", "Schimbă tema").

CSS: one `.segmented` block — track with `--border`, `--surface`; `.is-active` filled with
`--text` background and `--bg` text (inverts cleanly in both themes); the rest `--muted`.
Focus-visible ring on each segment. Sizes tuned to sit in the existing `min-height: 36px`
topbar without growing it. The old `.lang-toggle` / `.theme-toggle` rules are removed.

### Drama — single thermal face

Replace `.flames` with one emoji whose color rises with the rating. Map the 1–5 data
scale onto four colored thermal faces (Map B — only the top two ratings burst):

| drama | face | reads as |
|-------|------|----------|
| 1 | 🥶 | cold (blue) |
| 2 | 😐 | neutral (yellow) |
| 3 | 🥵 | hot (red) |
| 4 | 🤯 | exploding |
| 5 | 🤯 | exploding |

- `render.js`: build a single `<span class="drama-face">` with the mapped emoji.
  `aria-label` stays literal: `UI_STRINGS[lang].drama(match.drama)` → "dramă 4 din 5" /
  "drama 4 of 5". Add a `title` with the same text for sighted hover.
- A small pure helper `dramaFace(n)` maps rating→emoji, clamped to 1–5. Lives in `render.js`
  (rendering concern, like `STATUS_BADGE`).
- The `.flames`/`.flame` CSS and the `--flame` token usage for the row are removed;
  `--flame` may stay as a token but is no longer needed for the face (emoji carries color).

### Highlights — inline play icon in the header

Move the recap link from the card body into the match header, right of the drama face,
as an icon-only round button.

```
  Spania  2 – 1  Croația        🤯  ▷
  Iran    0 – 0  Qatar          🥶
```

- `render.js`: when `match.highlight` is set, append an `<a class="highlight-icon">` to the
  header's right cluster (the same flex group that holds the drama face), not the card body.
  Content is a ▷ glyph; `aria-label`/`title` = `UI_STRINGS[lang].recap` text reused, but
  reworded to the noun form already present (`recap` → "▶ Rezumat"/"▶ Highlights"); the
  visible glyph is the icon, the word lives in the tooltip/label only.
- `target="_blank"`, `rel="noopener"` as today. GoatCounter behavior unchanged (the link is
  still a plain anchor; no counting was attached to it before).
- The header right cluster becomes a small flex row: `[ drama-face ] [ highlight-icon? ]`,
  so the face stays put whether or not a highlight exists.
- The old full-width `.highlight` block CSS is removed; new `.highlight-icon` is a compact
  round tap target (min 32–36px) using the accent color for the glyph, transparent
  background, subtle hover.

## Files touched

- `site/assets/segmented.js` — new shared segmented-control builder.
- `site/assets/lang.js` — delegate DOM to `mountSegmented`; keep storage + `currentLang`.
- `site/assets/theme.js` — delegate DOM to `mountSegmented`; keep storage + OS-sync.
- `site/assets/render.js` — `dramaFace` helper; single face span; highlight icon in header.
- `site/assets/style.css` — add `.segmented`; add `.drama-face`, `.highlight-icon`;
  remove `.lang-toggle`, `.theme-toggle`, `.flames`/`.flame`, full-width `.highlight`.
- No HTML changes needed (both pages already call the same mount functions); verify the
  mount containers (`#topbar`, `.meta`) still receive both controls. Mount order today is
  theme-then-lang; the mockup shows `[RO|EN]` left of `[☀|☾]`, so either reorder the mount
  calls or let CSS order them — the lang pill must render first.

## Testing

Existing JS unit tests (`test/i18n.test.js`, render-related) must stay green. Add:

- `dramaFace(n)` unit coverage: 1→🥶, 2→😐, 3→🥵, 4→🤯, 5→🤯, and clamping for out-of-range.
- A `mountSegmented` DOM test (jsdom-style, matching existing patterns if present): mounting
  yields two radio buttons, the active one is marked, clicking the inactive one fires
  `onSelect` once with the new value and clicking the active one does not fire.

Manual / scenario (the real proof, per project rules):

- Serve `site/`, load `index.html` and `arhiva.html`.
- Toggle RO↔EN: both segments visible, active filled, all rendered facts + chrome re-localize,
  choice persists across reload. Confirm `<html lang>` updates.
- Toggle ☀↔☾: theme flips, persists, segmented active state follows; with no stored choice,
  OS theme change still re-syncs the control.
- Match cards: drama face matches the rating and is colored; the ▷ icon appears only when a
  highlight exists, opens the recap in a new tab, and the header stays on one row on a phone
  width (≤390px). Verify contrast of the active segment and the face in both light and dark.
- Screenshot before/after at phone width for the issue-14 record.

## Risks

- Emoji rendering varies by OS; 🥶😐🥵🤯 are widely supported but verify on the target
  devices (the friends' phones — mostly mobile). If a face renders monochrome on some
  platform the hue cue weakens; the `title`/`aria-label` keeps the literal rating as backup.
- Dark-mode contrast of the filled active segment (`--text` bg / `--bg` text) must be checked
  both ways; this is the main regression surface.

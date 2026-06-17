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

    // options: [{ value, label, title }]
    // getActive(): () => value — a getter, re-read on every sync (NOT a snapshot),
    //   so an external state change (OS theme flip) can re-sync the control.
    // onSelect(value): called only when the choice actually changes.
    // Returns { sync } so the caller can force a repaint after external state changes.
    export function mountSegmented(container, className, options, getActive, onSelect)

- Renders a `<div class="segmented {className}">` holding one plain
  `<button type="button">` per option. The active button gets `aria-pressed="true"`
  and the `.is-active` class; others `aria-pressed="false"`. **Plain toggle buttons with
  `aria-pressed`, not `role="radio"`** — radios would require a `radiogroup`, roving
  `tabindex`, and arrow-key handling that this control does not implement; `aria-pressed`
  matches the pattern the current `lang.js`/`theme.js` already use, so it is no regression.
- Clicking an inactive segment calls `onSelect(value)`; clicking the active one is a no-op.
- **Idempotency guard is class-scoped: `container.querySelector('.segmented.' + className)`.**
  Both controls mount into the *same* container on arhiva (`.meta`), so the guard MUST be
  scoped by the distinct per-control class — a generic `.segmented` check would make the
  second control a silent no-op. `lang.js` passes className `'lang'`, `theme.js` passes
  `'theme'`; the two classes must stay distinct.
- Returns `{ sync }`. `sync()` re-reads `getActive()` and repaints the active state. On the
  idempotent no-op path (already mounted) it still returns a working `{ sync }` bound to the
  existing DOM, so `theme.js` always has a handle to wire the OS-theme listener.

`lang.js` and `theme.js` keep their public functions (`mountLangToggle`,
`mountToggle`) and their storage/`currentLang`/`currentTheme` logic — they are rewritten
to delegate their DOM to `mountSegmented`:

- `mountLangToggle(container, onChange)` → segmented `[RO|EN]`, RO first. On select:
  persist `localStorage.lang`, set `document.documentElement.lang`, call `onChange(lang)`.
- `mountToggle(container)` → segmented `[☀|☾]`, className `'theme'`. On select: persist
  `localStorage.theme`, set `document.documentElement.dataset.theme`. It captures the
  returned `{ sync }`; the existing `matchMedia('change')` listener stays and calls that
  `sync()` when no explicit choice is stored, so an OS theme flip still repaints the control.

Titles for accessibility: lang segments `title`/`aria-label` "Română"/"English"; theme
segments "Temă luminoasă"/"Temă întunecată".

**Mount order (both pages):** reorder the call sites so `mountLangToggle` runs *before*
`mountToggle` on both `index.html` (`#topbar`) and `arhiva.html` (`.meta`) — DOM/append
order then puts `[RO|EN]` left of `[☀|☾]`. This is a 2-line edit per page; no CSS `order`
needed. (The earlier "no HTML changes" note is superseded — the `<script>` mount order
changes, the markup does not.)

CSS: one `.segmented` block — track with `--border`, `--surface`; `.is-active` filled with
`--text` background and `--bg` text (inverts cleanly in both themes); the rest `--muted`.
Focus-visible ring on each segment. Sized to sit within the existing `.topbar`
`min-height: 36px` without growing it. The old `.lang-toggle` / `.theme-toggle` rules are
removed.

**Arhiva (`.meta`) layout:** `.meta` is a `space-between` flex holding the title span and
the back-link, and today's flush-right relied on `.meta > .theme-toggle { margin-left: auto }`
— a rule that disappears with `.theme-toggle`. Replace it with a rule that keeps the controls
clustered flush-right on arhiva, e.g. `.meta > .segmented:first-of-type { margin-left: auto }`
(pushes the lang pill — and the theme pill after it — to the right edge, leaving title +
back-link on the left). `.meta` has no `min-height`, so verify the two pills don't grow the
bar taller than the back-link line; add a `min-height` to `.meta` if they do.

### Drama — single thermal face

Replace `.flames` with one emoji whose color rises with the rating. Map the 1–5 data
scale onto four colored thermal faces (Map B — only the top two ratings burst):

| drama | face | reads as |
|-------|------|----------|
| 1 | 🥶 | cold (blue) |
| 2 | 😐 | neutral (grey/yellow) |
| 3 | 🥵 | hot (red) |
| 4 | 🤯 | exploding |
| 5 | 🤯 | exploding |

- A small **pure, exported** helper `dramaFace(n)` in `render.js` maps rating→emoji.
  It must be `export`ed (current `render.js` exports only `renderDigest`/`loadDigest`) so the
  unit test can import it without a DOM. It lives in `render.js` because it is a rendering
  concern, but unlike the private `STATUS_BADGE` map it is exported for testability.
- **Absent/invalid rating:** today `drama=0`/`undefined` renders an *empty* `.flames` (no
  glyph). Preserve that: `dramaFace(n)` returns `null` when `n` is not a finite number ≥ 1
  (i.e. `0`, `undefined`, `null`, `NaN` → no face), and otherwise clamps to 1–5
  (`dramaFace(7)` → 🤯). `render.js` skips the face span when `dramaFace` returns `null`,
  so missing data shows nothing — not a spurious 🥶.
- `render.js`: when `dramaFace(match.drama)` is non-null, build a single
  `<span class="drama-face">` with the mapped emoji. `aria-label`/`title` use the **clamped**
  rating, not the raw value, via `UI_STRINGS[lang].drama(clamp(match.drama))` → "dramă 4 din 5"
  / "drama 4 of 5", so a stray `7` never announces "din 5" mismatched.
- The `.flames`/`.flame` CSS selectors are removed. The `--flame` custom-property
  *declaration* stays in `:root` (harmless, avoids churning both theme blocks); only its
  consuming selectors go. The drama-face hue comes from the emoji glyph itself.

### Highlights — inline play icon in the header

Move the recap link from the card body into the match header, right of the drama face,
as an icon-only round button.

```
  Spania  2 – 1  Croația        🤯  ▷
  Iran    0 – 0  Qatar          🥶
```

- **New glyph-free label key.** `UI_STRINGS[lang].recap` is currently `'▶ Rezumat'` /
  `'▶ Highlights'` — it already contains a ▶. Reusing it for the icon's `aria-label`/`title`
  would announce "black right-pointing triangle, Rezumat" and clash with the visible ▷.
  Replace it with a bare key `recapLabel: 'Rezumat video'` / `'Highlights'` (no glyph) for the
  icon's `aria-label`/`title`. The old `recap` key (`'▶ Rezumat'`) had exactly one consumer —
  render.js:87, the link being replaced — so remove it; the archive list uses the separate
  `recaps`/`recapsTitle` keys and is untouched. The visible button shows the ▷ glyph only; the
  word lives in `recapLabel` via `aria-label`/`title`.
- A **new right-cluster wrapper** is required. Today `.match-header` is `flex-wrap: wrap` and
  `.flames` is appended directly to it. Wrap the drama face + highlight icon in a
  `<div class="match-actions">` (a small `flex` row, `flex-shrink: 0`, `flex-wrap: nowrap`,
  `gap`) appended to `.match-header`. This keeps `[ drama-face ] [ highlight-icon? ]` on one
  line at phone width (≤390px) and the face fixed whether or not a highlight exists.
- The icon is an `<a class="highlight-icon">`: `href = match.highlight`, `target="_blank"`,
  `rel="noopener"`, content the ▷ glyph. GoatCounter behavior unchanged (still a plain anchor;
  no counting was attached to the old `.highlight` link, and none is added).
- The old full-width `.highlight` block CSS is removed; new `.highlight-icon` is a compact
  round tap target (min 32–36px) whose glyph uses the **`--pill-txt`** accent token (the
  site's existing accent; not `--flame`), transparent background, subtle hover.

## Files touched

- `site/assets/segmented.js` — new shared segmented-control builder; returns `{ sync }`.
- `site/assets/lang.js` — delegate DOM to `mountSegmented` (className `'lang'`); keep storage
  + `currentLang`.
- `site/assets/theme.js` — delegate DOM to `mountSegmented` (className `'theme'`); keep
  storage + `currentTheme`; capture `{ sync }` and call it from the `matchMedia` listener.
- `site/assets/i18n.js` — add `recapLabel` ('Rezumat video' / 'Highlights') to both lang
  blocks for the highlight-icon's glyph-free `aria-label`/`title`.
- `site/assets/render.js` — exported pure `dramaFace(n)` helper; single face span (skipped
  when null); `.match-actions` wrapper holding the face + highlight icon in the header.
- `site/assets/style.css` — add `.segmented`, `.drama-face`, `.highlight-icon`,
  `.match-actions`; replace `.meta > .theme-toggle { margin-left:auto }` with a
  `.meta > .segmented:first-of-type { margin-left:auto }` (and a `.meta` min-height if
  needed); remove `.lang-toggle`, `.theme-toggle`, `.flames`/`.flame`, full-width `.highlight`.
- `site/index.html` and `site/arhiva.html` — reorder the two mount calls so
  `mountLangToggle` runs before `mountToggle` (lang pill left). Markup unchanged.

## Testing

Existing JS unit tests (`test/i18n.test.js` etc.) must stay green. The repo has **no DOM
test harness** (no jsdom/happy-dom in `package.json`; every test is pure Node/pipeline), and
adding one is out of scope. So test only pure logic; `mountSegmented` DOM behavior is covered
by the manual scenario below, not a unit test.

- `dramaFace(n)` unit coverage (pure, no DOM — importable from `render.js` under plain
  `node --test`): 1→🥶, 2→😐, 3→🥵, 4→🤯, 5→🤯; clamp 6/7→🤯; and `0`, `undefined`, `null`,
  `NaN`, `2.5`→ defined behavior (`null` = no face, per the design). Confirm importing
  `render.js` in a Node test loads cleanly (its DOM calls are inside function bodies, so the
  module itself has no top-level `document` reference — verify this holds).

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

- Emoji hue is not vendor-guaranteed: 😐 renders **grey on most platforms, not yellow**, and
  on a monochrome-emoji platform the whole blue→red cue collapses. Target is the friends'
  phones (Apple/Android, color emoji), where it holds; the `title`/`aria-label` keeps the
  literal rating as the non-visual backup. Accept as known.
- Dark-mode contrast of the filled active segment (`--text` bg / `--bg` text) must be checked
  both ways; this is the main regression surface.
- OG image is unaffected: `og-image.js` draws a goal-sum "drama proxy" and a textual
  "▶ cu rezumate video" footer, not `match.drama` flames or the play icon — no change needed
  there. Stated only to close the loop; it is genuinely out of scope.

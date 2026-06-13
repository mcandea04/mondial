# Theme toggle — design

## Problem

The site already ships a dark theme via `@media (prefers-color-scheme: dark)` in
`site/assets/style.css`. People whose device is set to dark get the dark theme
automatically, and some of them find it hard to read. There is no way to override
the device setting. We add a two-state light/dark toggle that lets a reader pick a
theme regardless of the device, and we remember that choice.

## Behaviour

- Two states: **light** and **dark**. No explicit "auto".
- First visit (no saved choice): the site follows the device setting, exactly as
  today. The toggle still shows the theme currently in effect.
- When the reader taps the toggle, the theme flips and the choice is saved.
- The saved choice is remembered across reloads and across both pages
  (`index.html` and `arhiva.html`) via `localStorage`, key `"theme"`.
- A reader who has a saved choice always sees that choice, even if their device
  setting later changes. Clearing site data returns them to device-follows behaviour.
- No flash of the wrong theme on load (no FOUC).

## Where the toggle lives (revised — see note)

The toggle sits in a **static top bar present in each page's HTML, outside the
JS-rendered region**. On `index.html` that means a new `<header>` bar above `#app`;
on `arhiva.html` the existing static `.meta` bar (`arhiva.html:10`) hosts it.

This reverses the earlier "render.js builds it into the meta bar" decision. The
reason: `render.js`'s `renderHeader()` only runs inside `renderDigest()`, which the
index page calls **only on a successful fetch**. The error/loading paths
(`index.html:17-19` loading state, `:28-34` catch) never call `renderDigest`, so a
toggle mounted there would be **absent on exactly the screen the friends see most
mornings** — before the night's run has produced a digest ("Digestul de azi nu e
încă gata"). A static host is present in every state.

Keeping it static also avoids double-mounting bugs: `render.js` is **not** modified and
does **not** import `theme.js`, so a digest render never adds a second toggle, and
`mountToggle` is called exactly once per page.

The date/source line stays where it is (the rendered `.meta` on index, the static
`.meta` on arhiva). The toggle is its own always-present control, right-aligned in
the top bar. Because the bar that hosts it contains only the toggle (index) or a bar
whose layout we control (arhiva), there is no `justify-content: space-between`
three-child reflow problem.

## Theming mechanism (CSS)

Today dark tokens live only inside the media query. To let the button win over the
device, the dark tokens must also respond to an attribute on `<html>`. We keep the
media query (so first-time visitors keep working) and add an attribute rule.

The light tokens stay as the default `:root` block. The dark token block is applied
in two situations:

1. `:root[data-theme="dark"]` — reader forced dark.
2. `@media (prefers-color-scheme: dark)` when the reader has **not** forced light,
   i.e. `:root:not([data-theme="light"])` — device dark, no override or override is
   dark.

This means the dark token values appear in two selectors. We accept the
duplication (KISS over DRY): the no-duplication alternatives rely on obscure CSS or
push more logic into JS. The duplicated block is ~13 lines of custom-property
assignments and is unlikely to drift because both blocks are edited together.

Resulting structure in `style.css`:

    :root { /* light tokens — unchanged */ }

    :root[data-theme="dark"] { /* dark tokens */ }

    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) { /* same dark tokens */ }
    }

`data-theme` is either absent (follow device), `"light"`, or `"dark"`. No other value
is ever written; see value validation below.

## No-flash load

A small inline script in the `<head>` of both pages, placed **before** the
stylesheet link, reads `localStorage.theme`, **validates it against the allowed set**,
and sets `document.documentElement`'s `data-theme` synchronously. This runs before
first paint, so the correct theme is in effect immediately. It is inline (not an
imported module) precisely so it blocks paint; an external/module script would load
too late and reintroduce the flash.

The snippet is tiny and identical on both pages:

    <script>
      try {
        var t = localStorage.getItem('theme');
        if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
      } catch (e) {}
    </script>

**Placement on `index.html` (hazard):** the `<head>` contains the
`<!-- og:start -->`/`<!-- og:end -->` block that `run.js` token-replaces on every
pipeline run (see CLAUDE.md). The snippet MUST go **after the og:end marker and
before the `<link rel="stylesheet">`** so the pipeline never clobbers it. On
`arhiva.html` there is no og block; it goes right before the stylesheet link.

Validation here means a stale or corrupted value (e.g. `"auto"`, `"Dark"`) is
ignored, falling back to device-follows rather than the silent half-broken state a
non-matching attribute would cause.

## theme.js (new module, `site/assets/theme.js`)

No framework. A single storage key constant `THEME_KEY = 'theme'` shared by all
reads/writes (the inline snippet uses the same literal). Exports:

- `currentTheme()` — returns the theme in effect: the saved value if it is a valid
  `"light"`/`"dark"`, else the device preference resolved via
  `matchMedia('(prefers-color-scheme: dark)')`. If `matchMedia` is unavailable,
  default to `"light"`. Used to render the right button icon.
- `mountToggle(container)` — idempotent: if `container` already holds a
  `.theme-toggle`, it does nothing. Otherwise it creates a
  `<button class="theme-toggle">`, appends it, and wires the click. The button:
  - is a real `<button>` (keyboard-accessible, focusable);
  - carries a constant `aria-label` in Romanian ("Schimbă tema") and reflects state
    with `aria-pressed` (true when dark is in effect);
  - shows the **current** theme's icon (☀️ when light is in effect, 🌙 when dark);
  - on click: compute the next theme as the opposite of `currentTheme()`, set
    `document.documentElement.dataset.theme`, **best-effort** write it to
    `localStorage` inside a `try/catch` (a throw in private-mode/in-app browsers must
    not abort the in-memory flip), then update the icon and `aria-pressed`.

`mountToggle` also registers a `matchMedia('(prefers-color-scheme: dark)')` `change`
listener **once**, so that when there is **no saved choice** and the OS theme flips
live, the button icon updates to match what the CSS media query is already painting.
When a saved choice exists the listener leaves the icon alone (the saved choice wins).

`theme.js` performs no DOM or `matchMedia` access at import time — only inside its
functions — so importing it is side-effect-free.

## Wiring

- **index.html**: add a static `<header class="topbar">` immediately inside `<body>`,
  before `#app`. A small inline `type="module"` script imports `mountToggle` from
  `theme.js` and calls it against that header once, after the no-flash script has
  already set the initial theme. `render.js` is **not** touched.
- **arhiva.html**: the existing inline module imports `mountToggle` and calls it
  against the static `.meta` element (`arhiva.html:10`) once, before its
  manifest-loading `try` block so a manifest fetch failure cannot skip the mount.
  `render.js`'s per-digest `.meta` is irrelevant because `render.js` does not mount
  anything.

## Styling

Add a `.topbar` rule (index): a thin flex row, `justify-content: flex-end`, same
horizontal rhythm as the body, so the toggle sits top-right without disturbing the
date line below. Add a `.theme-toggle` rule: transparent background, no border, the
muted text colour, a comfortable tap target (`min-width` and `min-height` ~36px),
pointer cursor, and a subtle hover/focus-visible state using existing tokens. The
emoji icon carries the visible state; `aria-pressed` carries it for assistive tech,
so a monochrome-emoji fallback still leaves the control operable.

## Accepted risks (documented, not fixed)

- **CSP**: the no-flash guarantee depends on an inline `<head>` script with no nonce.
  No CSP exists today (GitHub Pages sets none). Adding a `script-src` policy without
  `'unsafe-inline'`/nonce would block it and reintroduce FOUC.
- **Icon points opposite the action**: ☀️ means "light is in effect", so tapping it
  goes to dark. This matches common toggles; `aria-label` stays constant.
- **Emoji glyph availability**: ☀️/🌙 are the visible affordance. The site already
  relies on emoji (🔥 at `style.css:132`, ▶ in `render.js`), so this is consistent
  with existing assumptions; `aria-pressed` covers assistive tech.
- **Cross-tab live sync**: toggling in one open tab does not update another open tab
  until it reloads. Out of scope.

## Out of scope (YAGNI)

- Three-state auto/light/dark toggle.
- Syncing the choice to the OG image or any server-side rendering (the site is static
  and the OG image is a fixed PNG).
- Animated theme transitions.

## Testing / verification

There is no JS test harness for `site/` (tests cover the pipeline). Verification is
by scenario in a browser:

1. Device set to **light**, no saved choice → site light, button shows ☀️.
2. Device set to **dark**, no saved choice → site dark, button shows 🌙 (today's
   behaviour preserved).
3. Tap toggle → theme flips, icon updates, `localStorage.theme` set.
4. Reload → saved theme still in effect, no flash of the other theme.
5. Navigate index ↔ arhiva → saved theme persists on both.
6. Clear `localStorage.theme`, reload → back to following the device.
7. **Error/loading state** (point index at a missing `latest.json`) → the toggle is
   still present in the top bar and still flips the theme.
8. **Stale value** (set `localStorage.theme = 'auto'`, reload) → ignored, follows
   device, no half-broken state.
9. **Live OS flip with no saved choice** → icon tracks the OS change.
10. **Storage blocked** (private/in-app browser) → toggle still flips the theme for
    the session, no exception.

Run with a local static server (e.g. `python3 -m http.server` from `site/`) and a
headed browser; toggle the OS appearance and the in-page button to walk the cases.
Capture screenshots of light and dark forced states for the completion report.

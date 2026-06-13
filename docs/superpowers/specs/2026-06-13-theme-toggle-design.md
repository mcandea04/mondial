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
  (`index.html` and `arhiva.html`) via `localStorage`.
- A reader who has a saved choice always sees that choice, even if their device
  setting later changes. Clearing site data returns them to device-follows behaviour.
- No flash of the wrong theme on load (no FOUC).

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

`data-theme` is either absent (follow device), `"light"`, or `"dark"`.

## No-flash load

A small inline script in the `<head>` of both pages, placed **before** the
stylesheet link, reads `localStorage.theme` and sets `document.documentElement`'s
`data-theme` synchronously. This runs before first paint, so the correct theme is in
effect immediately. It is inline (not an imported module) precisely so it blocks
paint; an external/module script would load too late and reintroduce the flash.

The snippet is tiny and identical on both pages:

    <script>
      try {
        var t = localStorage.getItem('theme');
        if (t) document.documentElement.dataset.theme = t;
      } catch (e) {}
    </script>

## theme.js (new module, `site/assets/theme.js`)

Two exports, no framework:

- `currentTheme()` — returns the theme in effect: the saved value if any, else the
  device preference resolved via `matchMedia('(prefers-color-scheme: dark)')`.
  Used to render the right button icon.
- `mountToggle(container)` — creates a `<button class="theme-toggle">`, appends it to
  `container`, and wires the click. The button:
  - is a real `<button>` (keyboard-accessible, focusable);
  - carries an `aria-label` in Romanian ("Schimbă tema");
  - shows the **current** theme's icon (☀️ when light is in effect, 🌙 when dark);
    `aria-label` stays constant.
  - on click: compute the next theme (opposite of what's in effect now), set
    `document.documentElement.dataset.theme`, write it to `localStorage`, and update
    the button icon.

`theme.js` does not import anything and has no side effects on import beyond defining
functions, so both the module page and render.js can use it freely.

## Wiring

- **index.html**: `renderHeader()` in `render.js` builds the `.meta` bar and is
  re-run on every `renderDigest()` call (it wipes `#app`). `render.js` imports
  `mountToggle` from `theme.js` and calls it while building the meta bar, so the
  toggle is rebuilt with the header and always present. This adds a single, small
  import edge from `render.js` to `theme.js`.
- **arhiva.html**: the meta bar is static HTML. The page's inline module imports
  `mountToggle` and calls it against the existing `.meta` element after load.

The button is appended to the right side of the meta bar, after the existing
right-hand span, so it sits inline with the date/source line as requested.

## Styling

Add a `.theme-toggle` rule to `style.css`: transparent background, no border, the
muted text colour, a comfortable tap target (min ~32px), pointer cursor, and a subtle
hover/focus state using existing tokens. The emoji icon carries the colour so it
reads in both themes; the button itself stays minimal so it doesn't compete with the
date line.

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

Run with a local static server (e.g. `python3 -m http.server` from `site/`) and a
headed browser; toggle the OS appearance and the in-page button to walk the cases.
Capture screenshots of light and dark forced states for the completion report.

# Theme Toggle — Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent light/dark theme toggle to both site pages, with no flash of the wrong theme on load.

**Architecture:** A new `site/assets/theme.js` module owns all toggle logic. A tiny inline `<head>` script handles no-flash by reading `localStorage` synchronously before first paint. The toggle button is mounted into a static HTML host element on each page (a new `<header class="topbar">` on index, the existing `.meta` bar on arhiva), so it is present even during error/loading states. CSS dark tokens are duplicated under both a `data-theme="dark"` attribute selector and the existing media query.

**Tech Stack:** Vanilla JS (ESM), CSS custom properties, `localStorage`, `matchMedia`.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `site/assets/theme.js` | **Create** | `currentTheme()`, `mountToggle(container)` |
| `site/assets/style.css` | **Modify** | Duplicate dark tokens under `[data-theme="dark"]`; refine media query guard; add `.topbar` and `.theme-toggle` rules |
| `site/index.html` | **Modify** | Add no-flash inline `<head>` script; add `<header class="topbar">`; wire `mountToggle` |
| `site/arhiva.html` | **Modify** | Add no-flash inline `<head>` script; wire `mountToggle` on the static `.meta` element |

`site/assets/render.js` is **not touched**.

---

### Task 1: CSS — dark token duplication and new layout rules

**Files:**
- Modify: `site/assets/style.css`

The dark token block currently lives only inside `@media (prefers-color-scheme: dark) :root { … }`. We need it in two places:

1. `:root[data-theme="dark"]` — user has forced dark.
2. `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` — device dark, no light override.

We also add `.topbar` (a thin flex bar for the index page) and `.theme-toggle` (the button).

- [ ] **Step 1: Open `site/assets/style.css` and locate the media query block (lines 30–51)**

Verify the dark token block starts at `@media (prefers-color-scheme: dark)` and that `:root` inside it lists all the dark custom properties.

- [ ] **Step 2: Replace the media query block with the expanded three-part dark-mode block**

Replace the entire `@media (prefers-color-scheme: dark) { :root { … } }` block (currently lines 30–51) with:

```css
:root[data-theme="dark"] {
  --bg:       #1c1c1a;
  --surface:  #272725;
  --border:   rgba(255,255,255,0.10);
  --text:     #f0ede6;
  --muted:    #9e9d98;

  --ok-bg:    #04342c; --ok-txt:    #9fe1cb;
  --good-bg:  #173404; --good-txt:  #c0dd97;
  --warn-bg:  #412402; --warn-txt:  #fac775;
  --danger-bg:#501313; --danger-txt:#f7c1c1;

  --pill-bg:  #4a1b0c; --pill-txt: #f0997b; --pill-head: #f5c4b3;

  --home: #7db0e6;
  --away: #e0a948;
  --card: #f0726f;

  --flag-outline: rgba(255, 255, 255, 0.18);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg:       #1c1c1a;
    --surface:  #272725;
    --border:   rgba(255,255,255,0.10);
    --text:     #f0ede6;
    --muted:    #9e9d98;

    --ok-bg:    #04342c; --ok-txt:    #9fe1cb;
    --good-bg:  #173404; --good-txt:  #c0dd97;
    --warn-bg:  #412402; --warn-txt:  #fac775;
    --danger-bg:#501313; --danger-txt:#f7c1c1;

    --pill-bg:  #4a1b0c; --pill-txt: #f0997b; --pill-head: #f5c4b3;

    --home: #7db0e6;
    --away: #e0a948;
    --card: #f0726f;

    --flag-outline: rgba(255, 255, 255, 0.18);
  }
}
```

- [ ] **Step 3: Add `.topbar`, `.theme-toggle`, and `.meta > .theme-toggle` rules at the end of `style.css` (before the final newline)**

```css
/* ── Theme topbar (index) ── */
.topbar {
  display: flex;
  justify-content: flex-end;
  padding: 0 0 4px;
}

/* ── Theme toggle button ── */
.theme-toggle {
  background: transparent;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 18px;
  min-width: 36px;
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  padding: 4px;
}
.theme-toggle:hover,
.theme-toggle:focus-visible {
  color: var(--text);
  outline: 2px solid var(--border);
  outline-offset: 2px;
}

/* Keep the toggle flush-right in .meta without reordering the back-link */
.meta > .theme-toggle {
  margin-left: auto;
}
```

- [ ] **Step 4: Verify the file still has a single trailing newline and no syntax errors**

Open the file, confirm the last line is a newline after the closing `}` of `.theme-toggle:hover`.

- [ ] **Step 5: Commit**

```bash
git add site/assets/style.css
git commit -m "feat: expand dark tokens to data-theme attribute and add topbar/toggle styles"
```

---

### Task 2: Create `site/assets/theme.js`

**Files:**
- Create: `site/assets/theme.js`

This module exports two functions. It does **no** DOM or `matchMedia` access at import time.

- [ ] **Step 1: Create the file with the full implementation**

```js
const THEME_KEY = 'theme';

/**
 * Returns the theme currently in effect: the validated saved choice if present,
 * otherwise the device preference. Falls back to 'light' if matchMedia is unavailable.
 * @returns {'light'|'dark'}
 */
export function currentTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch (_) {}
  if (typeof matchMedia !== 'undefined') {
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

/**
 * Mounts a theme toggle button inside `container`. Idempotent: a second call
 * on the same container is a no-op.
 * @param {HTMLElement} container
 */
export function mountToggle(container) {
  if (container.querySelector('.theme-toggle')) return;

  const btn = document.createElement('button');
  btn.className = 'theme-toggle';
  btn.setAttribute('aria-label', 'Schimbă tema');

  function sync() {
    const dark = currentTheme() === 'dark';
    btn.textContent = dark ? '🌙' : '☀️';
    btn.setAttribute('aria-pressed', String(dark));
  }

  btn.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (_) {}
    sync();
  });

  container.append(btn);
  sync();

  const mq = typeof matchMedia !== 'undefined'
    ? matchMedia('(prefers-color-scheme: dark)')
    : null;
  if (mq) {
    mq.addEventListener('change', () => {
      try {
        const saved = localStorage.getItem(THEME_KEY);
        if (saved === 'light' || saved === 'dark') return;
      } catch (_) {}
      sync();
    });
  }
}
```

- [ ] **Step 2: Verify the file ends with a single newline**

The last line of the file must be an empty line after the closing `}` of `mountToggle`.

- [ ] **Step 3: Commit**

```bash
git add site/assets/theme.js
git commit -m "feat: add theme.js with currentTheme and mountToggle"
```

---

### Task 3: Wire theme toggle into `index.html`

**Files:**
- Modify: `site/index.html`

Two changes: (1) add the no-flash inline script in `<head>` after the `<!-- og:end -->` marker and before `<link rel="stylesheet">`; (2) add a `<header class="topbar">` as the first child of `<body>` and mount the toggle there.

- [ ] **Step 1: Add the no-flash inline script to `<head>`**

In `site/index.html`, locate:
```html
  <!-- og:end -->
  <link rel="stylesheet" href="assets/style.css" />
```

Replace with:
```html
  <!-- og:end -->
  <script>
    try {
      var t = localStorage.getItem('theme');
      if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    } catch (e) {}
  </script>
  <link rel="stylesheet" href="assets/style.css" />
```

- [ ] **Step 2: Add the topbar header and module wiring to `<body>`**

Locate the opening of `<body>`:
```html
<body>
  <main id="app">
```

Replace with:
```html
<body>
  <header class="topbar" id="topbar"></header>
  <main id="app">
```

- [ ] **Step 3: Add the mount call as a module script after `<main>`**

Locate the existing module script block:
```html
  <script type="module">
    import { renderDigest, loadDigest } from './assets/render.js';
```

Add a new module script **before** it (between `</main>` and the existing `<script type="module">`):
```html
  <script type="module">
    import { mountToggle } from './assets/theme.js';
    mountToggle(document.getElementById('topbar'));
  </script>
```

- [ ] **Step 4: Verify the placement is correct**

Open `index.html` and confirm:
1. The inline `<script>` is between `<!-- og:end -->` and `<link rel="stylesheet">`.
2. `<header class="topbar" id="topbar">` is the first element inside `<body>`.
3. The `mountToggle` module script appears before the `renderDigest` module script.
4. There are no duplicate `<script>` blocks.

- [ ] **Step 5: Commit**

```bash
git add site/index.html
git commit -m "feat: add no-flash script and topbar toggle to index.html"
```

---

### Task 4: Wire theme toggle into `arhiva.html`

**Files:**
- Modify: `site/arhiva.html`

Same two changes: no-flash inline script in `<head>`, then mount toggle into the existing static `.meta` bar at the top of `<body>`.

- [ ] **Step 1: Add the no-flash inline script to `<head>`**

In `site/arhiva.html`, locate:
```html
  <link rel="stylesheet" href="assets/style.css" />
```

Replace with:
```html
  <script>
    try {
      var t = localStorage.getItem('theme');
      if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    } catch (e) {}
  </script>
  <link rel="stylesheet" href="assets/style.css" />
```

- [ ] **Step 2: Add a toggle mount call at the start of the existing inline module script**

In `site/arhiva.html`, locate the opening of the existing module script:
```html
  <script type="module">
    import { renderDigest, loadDigest } from './assets/render.js';
```

Replace with:
```html
  <script type="module">
    import { renderDigest, loadDigest } from './assets/render.js';
    import { mountToggle } from './assets/theme.js';

    mountToggle(document.querySelector('.meta'));
```

This call runs **before** the manifest-loading `try` block that follows, so a fetch failure cannot prevent the toggle from mounting.

- [ ] **Step 3: Verify the existing `.meta` DOM element and layout**

Open `arhiva.html` and confirm the static `.meta` div (line 10) is present and is the first child of `<body>`. The toggle will be appended as a third child of `.meta` after the two existing `<span>` elements ("Arhiva dimineților" and "← azi").

**Layout note:** `.meta` uses `justify-content: space-between` (style.css:67-73). With three flex children, `space-between` distributes them as left / center / right — so appending the button without any layout adjustment would push the "← azi" link to the center of the bar. To prevent this reflow, add the following CSS rule to `style.css` in Task 1 Step 3 (alongside `.topbar` and `.theme-toggle`):

```css
/* Keep the toggle flush-right in .meta without reordering the back-link */
.meta > .theme-toggle {
  margin-left: auto;
}
```

This collapses all the free space to the left of the toggle, so "Arhiva dimineților" stays left-aligned and "← azi" stays immediately next to it, with the toggle anchored at the right edge. No change to the existing two `<span>` elements or to `.meta`'s own rules is needed.

- [ ] **Step 4: Commit**

```bash
git add site/arhiva.html
git commit -m "feat: add no-flash script and toggle mount to arhiva.html"
```

---

### Task 5: Browser scenario verification

**No code changes. This task is pure verification.**

Start a local server from the `site/` directory:

```bash
cd site && python3 -m http.server 8000
```

Open `http://localhost:8000` in a headed browser. Walk all 10 scenarios from the spec:

- [ ] **Scenario 1 — Device light, no saved choice**
  1. Open DevTools → Application → Local Storage → clear `theme` key.
  2. Set OS to light mode.
  3. Reload. Expect: light theme, button shows ☀️.

- [ ] **Scenario 2 — Device dark, no saved choice**
  1. Clear `localStorage.theme`.
  2. Set OS to dark mode.
  3. Reload. Expect: dark theme, button shows 🌙.

- [ ] **Scenario 3 — Tap toggle**
  1. With dark active, tap the button. Expect: light theme, button shows ☀️, `localStorage.theme` = `"light"`.
  2. Tap again. Expect: dark theme, button shows 🌙, `localStorage.theme` = `"dark"`.

- [ ] **Scenario 4 — Reload persists saved choice**
  1. With `localStorage.theme = "light"` and device dark, reload.
  2. Expect: light theme, no flash, button shows ☀️.

- [ ] **Scenario 5 — Cross-page persistence**
  1. With a saved choice, navigate to `arhiva.html`.
  2. Expect: same theme, toggle visible in the `.meta` bar at top-right.
  3. Navigate back to `index.html`. Expect: same theme.

- [ ] **Scenario 6 — Clear localStorage returns to device**
  1. Clear `localStorage.theme`.
  2. Reload. Expect: theme matches OS setting.

- [ ] **Scenario 7 — Error/loading state**
  1. Point the fetch to a missing file: in DevTools Network, block `latest.json`.
  2. Reload. Expect: "Digestul de azi nu e încă gata" message AND the topbar toggle is present and working.

- [ ] **Scenario 8 — Stale localStorage value**
  1. In DevTools console: `localStorage.setItem('theme', 'auto')`.
  2. Reload. Expect: falls back to device setting, no broken state, button icon matches device.

- [ ] **Scenario 9 — Live OS flip with no saved choice**
  1. Clear `localStorage.theme`.
  2. With the page open, flip OS from dark to light (or vice versa).
  3. Expect: button icon updates without reload (CSS updates instantly via media query; icon updates via the `change` listener).

- [ ] **Scenario 10 — Storage blocked**
  1. Open the page in a private/incognito window (some browsers block `localStorage` in incognito).
  2. Tap the toggle. Expect: theme flips in-page, no uncaught exception in DevTools console.

- [ ] **Capture screenshots**

Take two screenshots and save them under `.artifacts/main/screenshots/`:
- `theme-toggle-light.png` — light mode, toggle visible.
- `theme-toggle-dark.png` — dark mode, toggle visible.

- [ ] **Commit final verification artefacts (if any)**

If screenshots were captured, commit them:

```bash
git add .artifacts/main/screenshots/theme-toggle-*.png 2>/dev/null || true
git commit -m "chore: add theme toggle verification screenshots" --allow-empty
```

---

## Self-review against spec

| Spec section | Covered by |
|---|---|
| Two states light/dark | Task 2 `currentTheme` / `mountToggle` click handler |
| First visit follows device | Task 2 `currentTheme` (no saved choice → matchMedia) |
| Toggle flips and saves | Task 2 `mountToggle` click handler |
| `localStorage` key `"theme"` | Task 2 `THEME_KEY` constant |
| Saved choice wins over device change | Task 2 `mountToggle` `change` listener guard |
| No FOUC | Tasks 3 & 4 inline `<head>` scripts |
| Static host for toggle | Tasks 3 & 4 (topbar / .meta) |
| render.js not modified | Not in file map |
| `data-theme` CSS mechanism | Task 1 |
| `[data-theme="dark"]` + media query guard | Task 1 |
| Inline script after og:end, before stylesheet | Task 3 Step 1 |
| Idempotent `mountToggle` | Task 2 early-return guard |
| `aria-label` + `aria-pressed` | Task 2 |
| matchMedia change listener | Task 2 |
| No side effects at import | Task 2 (functions only called inside `mountToggle`/`currentTheme`) |
| Private mode safety (`try/catch`) | Task 2 |
| Stale value ignored | Task 2 `currentTheme` validation + inline script |
| All 10 browser scenarios | Task 5 |

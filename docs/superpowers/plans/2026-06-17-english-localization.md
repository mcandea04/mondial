# English Localization + Language Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the whole site readable in English as well as Romanian — UI chrome and model-written narration — with a header toggle that persists in localStorage (default Romanian).

**Architecture:** Facts stay single-language and code-owned; only model prose becomes per-language `{ ro, en }` objects in each day's JSON. A parallel English voice prompt generates EN narration from the same facts (keyed back by match `id`), run sequentially after RO. EN is best-effort: any EN failure ships RO-only. The site picks language at render time via a pure i18n helper module; legacy flat-string prose falls back to RO.

**Tech Stack:** Node 20 ESM, `node --test`, zod, vanilla browser JS (no framework, no build step), Gemini / headless Claude narration engines.

## Global Constraints

- ESM only (`"type": "module"`), Node 20+.
- All Romanian user-facing text keeps correct diacritics (ă â î ș ț).
- **Core principle (never violate):** code establishes facts, the model only writes voice. EN narration contributes only `headline`/`summary`/`pill`/`drama`/`alarm`/`why`; it never originates a score, scorer, minute, card, or standings value. EN output is keyed back to facts by match `id` and merged verbatim.
- EN failure must never block the morning — ship RO-only (mirrors the existing Opus→Gemini degrade).
- No new dependencies. No build step.
- This is a `~/personal/` project: push to **github.com/mcandea04** only.
- Real RO alarm enum is `merită văzut` / `citești dimineața` (NOT `stai treaz`). EN enum is `stay up` / `read in the morning`.

## Design note — `getNarration` return shape (deviation from spec)

The spec sketched a nested `{ ro:{narration,narrator}, en:{...} }` return. To avoid rewriting ~15 existing destructure sites in `test/narrator-select.test.js` and `main()`, this plan uses an **additive** shape instead:

```
{ narration, narrator, en: { narration, narrator } | null }
```

RO stays exactly where it is today (`narration`, `narrator` at top level), so every existing test and the `({ narration, narrator } = ...)` destructure in `main()` keep working unchanged. EN is purely added. Same behavior, far less churn.

## File map

- `pipeline/narration-core.js` — add `SYSTEM_PROMPT_EN`, `narrationSchemaEn`, `CRITIQUE_SYSTEM_PROMPT_EN`, `buildRewriteSystemPromptEn`, `localizeProse` helper.
- `pipeline/narrate.js` — add `responseSchemaEn` (Gemini server-side mirror) + an EN entry point.
- `pipeline/narration-polish.js` — parameterize the prompt trio (default RO).
- `pipeline/teaser.js` — add `buildTeaserEn`.
- `pipeline/run.js` — `getNarration` EN branch; `main` assembly into `{ro,en}`; `recentProseBefore`/`withoutGold` localize to RO.
- `pipeline/backfill-en.js` — NEW one-time migration.
- `site/assets/i18n.js` — NEW pure module: `localize`, `UI_STRINGS`, `STATUS_LABEL`, `WATCH_ALARMS`/`alarmIsWatch`, date formatters. Unit-tested.
- `site/assets/lang.js` — NEW: `currentLang`, `mountLangToggle` (DOM, mirrors `theme.js`).
- `site/assets/render.js` — thread `lang` through; read prose via `localize`; labels via `UI_STRINGS`.
- `site/index.html`, `site/arhiva.html` — mount toggle, re-render on change, `<html lang>` bootstrap.
- `test/fixtures/narration.en.json` — NEW EN offline fixture.
- `test/i18n.test.js`, `test/narration-core.test.js` (or extend), `test/teaser.test.js`, `test/prose-reuse.test.js`, `test/run.test.js`, `test/narrator-select.test.js` — tests.

---

### Task 1: Pure i18n helper module (site)

**Files:**
- Create: `site/assets/i18n.js`
- Test: `test/i18n.test.js`

**Interfaces:**
- Produces:
  - `localize(field, lang)` → string. `field` is a string (legacy RO) or `{ro,en}`; returns `field` if string, else `field[lang] ?? field.ro ?? ''`; `''` when field is null/undefined.
  - `WATCH_ALARMS` (Set), `alarmIsWatch(value)` → boolean.
  - `UI_STRINGS` → `{ ro: {...}, en: {...} }` keyed by label id.
  - `STATUS_LABEL` → `{ ro: {...}, en: {...} }` mapping the four RO status values to display text.
  - `dateLabel(date, lang)` → formatted weekday string (capitalized first letter).

- [ ] **Step 1: Write the failing test**

```js
// test/i18n.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localize, alarmIsWatch, UI_STRINGS, STATUS_LABEL, dateLabel } from '../site/assets/i18n.js';

test('localize: legacy string passes through unchanged', () => {
  assert.equal(localize('salut', 'en'), 'salut');
});

test('localize: object picks active language', () => {
  assert.equal(localize({ ro: 'salut', en: 'hello' }, 'en'), 'hello');
  assert.equal(localize({ ro: 'salut', en: 'hello' }, 'ro'), 'salut');
});

test('localize: falls back to ro when en missing', () => {
  assert.equal(localize({ ro: 'salut' }, 'en'), 'salut');
});

test('localize: empty for null/undefined', () => {
  assert.equal(localize(null, 'en'), '');
  assert.equal(localize(undefined, 'ro'), '');
});

test('alarmIsWatch recognizes both languages and the legacy RO token', () => {
  assert.equal(alarmIsWatch('merită văzut'), true);
  assert.equal(alarmIsWatch('stai treaz'), true); // legacy archive value
  assert.equal(alarmIsWatch('stay up'), true);
  assert.equal(alarmIsWatch('citești dimineața'), false);
  assert.equal(alarmIsWatch('read in the morning'), false);
});

test('UI_STRINGS has parallel keys in both languages', () => {
  const roKeys = Object.keys(UI_STRINGS.ro).sort();
  const enKeys = Object.keys(UI_STRINGS.en).sort();
  assert.deepEqual(roKeys, enKeys);
});

test('STATUS_LABEL covers all four statuses in both languages', () => {
  for (const status of ['calificată', 'în cărți', 'are nevoie de minune', 'eliminată']) {
    assert.ok(STATUS_LABEL.ro[status]);
    assert.ok(STATUS_LABEL.en[status]);
  }
});

test('dateLabel returns a capitalized localized weekday', () => {
  const ro = dateLabel('2026-06-17', 'ro');
  const en = dateLabel('2026-06-17', 'en');
  assert.equal(ro[0], ro[0].toUpperCase());
  assert.match(en, /June|Jun/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/i18n.test.js`
Expected: FAIL — cannot find module `site/assets/i18n.js`.

- [ ] **Step 3: Write the module**

```js
// site/assets/i18n.js
/* Pure, framework-free localization helpers shared by render.js. No DOM here. */

// Watch-tonight alarm tokens across both languages plus the legacy RO value
// (`stai treaz`) that three early archive days stored before the enum settled.
export const WATCH_ALARMS = new Set(['merită văzut', 'stai treaz', 'stay up']);

export function alarmIsWatch(value) {
  return WATCH_ALARMS.has(value);
}

/**
 * Reads a prose field for the active language. A plain string is legacy RO-only
 * and passes through; an object is per-language with an ro fallback.
 */
export function localize(field, lang) {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  return field[lang] ?? field.ro ?? '';
}

export const UI_STRINGS = {
  ro: {
    nightHere: 'azi-noapte la Mondial',
    noMatches: 'fără meciuri',
    oneMatch: '1 meci',
    manyMatches: (n) => `${n} meciuri`,
    emptyNight: 'Azi-noapte nu s-a jucat niciun meci. Vezi mai jos ce urmează.',
    tonightTitle: 'La noapte — merită alarma?',
    group: (name) => `Grupa ${name}`,
    colTeam: 'Echipă',
    colPlayed: 'MJ',
    colGd: 'GD',
    colPts: 'Pct',
    colStatus: 'Status',
    recap: '▶ Rezumat',
    share: 'Share ↗',
    eest: 'EEST',
  },
  en: {
    nightHere: 'last night at the World Cup',
    noMatches: 'no matches',
    oneMatch: '1 match',
    manyMatches: (n) => `${n} matches`,
    emptyNight: 'No matches were played last night. See what is coming up below.',
    tonightTitle: 'Tonight — worth the alarm?',
    group: (name) => `Group ${name}`,
    colTeam: 'Team',
    colPlayed: 'P',
    colGd: 'GD',
    colPts: 'Pts',
    colStatus: 'Status',
    recap: '▶ Highlights',
    share: 'Share ↗',
    eest: 'EEST',
  },
};

export const STATUS_LABEL = {
  ro: {
    'calificată': 'calificată',
    'în cărți': 'în cărți',
    'are nevoie de minune': 'are nevoie de minune',
    'eliminată': 'eliminată',
  },
  en: {
    'calificată': 'through',
    'în cărți': 'in the mix',
    'are nevoie de minune': 'needs a miracle',
    'eliminată': 'out',
  },
};

const WEEKDAY_FMT = {
  ro: new Intl.DateTimeFormat('ro-RO', { timeZone: 'Europe/Bucharest', weekday: 'long', day: 'numeric', month: 'long' }),
  en: new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', weekday: 'long', day: 'numeric', month: 'long' }),
};

export function dateLabel(date, lang) {
  const label = (WEEKDAY_FMT[lang] ?? WEEKDAY_FMT.ro).format(new Date(`${date}T06:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/i18n.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add site/assets/i18n.js test/i18n.test.js
git commit -m "feat: pure i18n helpers (localize, UI_STRINGS, alarm/status maps)"
```

---

### Task 2: Thread language through render.js

**Files:**
- Modify: `site/assets/render.js`
- (No unit test — render.js is DOM-only and untested today, like `theme.js`. Verified by the browser scenario in Task 12.)

**Interfaces:**
- Consumes: Task 1 (`localize`, `UI_STRINGS`, `STATUS_LABEL`, `alarmIsWatch`, `dateLabel`).
- Produces: `renderDigest(root, digest, lang)` — `lang` defaults to `'ro'`. `loadDigest(url)` unchanged.

- [ ] **Step 1: Add the import and replace the hardcoded weekday formatter**

At the top of `site/assets/render.js`, add:

```js
import { localize, UI_STRINGS, STATUS_LABEL, alarmIsWatch, dateLabel } from './i18n.js';
```

Delete the module-level `WEEKDAY_FMT` constant and the `capitalize` function (now provided by `dateLabel`). Remove the `STATUS_BADGE` lookup's reliance on label text (keep the class map, see below).

- [ ] **Step 2: Replace `STATUS_BADGE` to key off canonical RO status**

The badge CSS class must keep keying off the canonical RO status value (the fact), while the visible label comes from `STATUS_LABEL`. Keep this map:

```js
const STATUS_BADGE = {
  'calificată': 'badge-ok',
  'în cărți': 'badge-good',
  'are nevoie de minune': 'badge-warn',
  'eliminată': 'badge-danger',
};
```

- [ ] **Step 3: Thread `lang` and `t` (the UI string table) through the render functions**

Rewrite the relevant functions so each receives `lang`. Full replacements:

```js
function renderHeader(root, digest, lang) {
  const t = UI_STRINGS[lang];
  const meta = el('div', 'meta');
  meta.append(
    el('span', null, `${dateLabel(digest.date, lang)} · ${t.nightHere}`),
    el('span', null, matchCountLabel(digest.matches.length, lang)),
  );
  root.append(meta, el('h1', null, localize(digest.headline, lang)), el('p', 'summary', localize(digest.summary, lang)));
}

function matchCountLabel(n, lang) {
  const t = UI_STRINGS[lang];
  if (n === 0) return t.noMatches;
  if (n === 1) return t.oneMatch;
  return t.manyMatches(n);
}
```

In `renderMatchCard(match, lang)`: replace `match.pill` with `localize(match.pill, lang)` and the highlight link text `'▶ Rezumat'` with `UI_STRINGS[lang].recap`.

```js
function renderMatchCard(match, lang) {
  const card = el('div', 'card');
  const header = el('div', 'match-header');
  const teams = el('div', 'match-teams');
  const score = el('span', 'score', `${match.score[0]} – ${match.score[1]}`);
  teams.append(
    teamName('team-name home', match.home, match.homeCode, 'before'),
    score,
    teamName('team-name away', match.away, match.awayCode, 'after'),
  );
  const flames = el('div', 'flames');
  flames.setAttribute('aria-label', `dramă ${match.drama} din 5`);
  for (let i = 0; i < match.drama; i += 1) {
    const flame = el('span', 'flame');
    flame.setAttribute('aria-hidden', 'true');
    flames.append(flame);
  }
  header.append(teams, flames);
  card.append(header);

  const events = renderEvents(match);
  if (events) card.append(events);

  const pillText = localize(match.pill, lang);
  if (pillText) {
    const pill = el('div', 'pill');
    pill.append(el('p', 'pill-text', pillText));
    card.append(pill);
  }

  if (match.highlight) {
    const link = el('a', 'highlight', UI_STRINGS[lang].recap);
    link.href = match.highlight;
    link.target = '_blank';
    link.rel = 'noopener';
    card.append(link);
  }
  return card;
}
```

In `renderGroupCard(group, lang)`: table headers from `UI_STRINGS`, card label from `t.group(group.name)`, status label from `STATUS_LABEL[lang][row.status] ?? row.status`, class still from `STATUS_BADGE`:

```js
function renderGroupCard(group, lang) {
  const t = UI_STRINGS[lang];
  const card = el('div', 'card');
  card.append(el('p', 'card-label', t.group(group.name)));

  const table = el('table');
  const thead = el('thead');
  const headRow = el('tr');
  for (const [label, cls] of [
    [t.colTeam, 'col-team'],
    [t.colPlayed, 'col-num'],
    [t.colGd, 'col-num'],
    [t.colPts, 'col-num'],
    [t.colStatus, 'col-stat'],
  ]) {
    headRow.append(el('td', cls, label));
  }
  thead.append(headRow);

  const tbody = el('tbody');
  for (const row of group.table) {
    const tr = el('tr');
    tr.append(
      teamCell(row),
      el('td', 'col-num', String(row.p)),
      el('td', 'col-num', row.gd > 0 ? `+${row.gd}` : String(row.gd)),
      el('td', 'col-num pts', String(row.pts)),
    );
    const statusCell = el('td', 'col-stat');
    const labelText = STATUS_LABEL[lang][row.status] ?? row.status;
    statusCell.append(el('span', `badge ${STATUS_BADGE[row.status] ?? 'badge-muted'}`, labelText));
    tr.append(statusCell);
    tbody.append(tr);
  }
  table.append(thead, tbody);
  card.append(table);
  return card;
}
```

In `renderTonight(tonight, lang)`: card label from `t.tonightTitle`, alarm text via `localize(fixture.alarm, lang)`, badge class via `alarmIsWatch(localize(fixture.alarm, lang))`, why via `localize(fixture.why, lang)`, the EEST suffix from `t.eest`:

```js
function renderTonight(tonight, lang) {
  const t = UI_STRINGS[lang];
  const card = el('div', 'card');
  card.append(el('p', 'card-label', t.tonightTitle));
  for (const fixture of tonight) {
    const row = el('div', 'tonight-row');
    const left = el('div');
    const matchLine = el('span', 'team');
    matchLine.append(
      ...[
        flagImg(fixture.homeCode, 'flag-sm'),
        el('span', 'tonight-match', `${fixture.home} – ${fixture.away}`),
        flagImg(fixture.awayCode, 'flag-sm'),
      ].filter(Boolean),
    );
    left.append(matchLine, el('span', 'tonight-time', ` · ${fixture.kickoffEEST} ${t.eest}`));
    const whyText = localize(fixture.why, lang);
    if (whyText) {
      left.append(el('br'), el('span', 'tonight-why', whyText));
    }
    const alarmText = localize(fixture.alarm, lang);
    const badgeClass = alarmIsWatch(alarmText) ? 'badge-ok' : 'badge-muted';
    row.append(left, el('span', `badge ${badgeClass}`, alarmText));
    card.append(row);
  }
  return card;
}
```

In `renderShareBar(digest, lang)`: button label from `t.share`, share text via `localize(digest.teaser, lang)`:

```js
function renderShareBar(digest, lang) {
  const t = UI_STRINGS[lang];
  const shareText = localize(digest.teaser, lang);
  const bar = el('div', 'share-bar');
  bar.append(el('div', 'share-text', shareText));

  const waLink = el('a', 'share-btn', t.share);
  waLink.href = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
  waLink.target = '_blank';
  waLink.rel = 'noopener';
  waLink.addEventListener('click', (event) => {
    window.goatcounter?.count?.({ path: 'share-whatsapp', title: 'WhatsApp share', event: true });
    if (navigator.share) {
      event.preventDefault();
      navigator.share({ text: shareText }).catch(() => {});
    }
  });
  bar.append(waLink);
  return bar;
}
```

- [ ] **Step 4: Update `renderDigest` to accept and thread `lang`**

```js
export function renderDigest(root, digest, lang = 'ro') {
  root.replaceChildren();
  renderHeader(root, digest, lang);

  if (digest.matches.length === 0) {
    const emptyCard = el('div', 'card');
    emptyCard.append(el('p', 'empty-state', UI_STRINGS[lang].emptyNight));
    root.append(emptyCard);
  }
  for (const match of digest.matches) root.append(renderMatchCard(match, lang));
  for (const group of digest.groups) root.append(renderGroupCard(group, lang));
  if (digest.tonight.length) root.append(renderTonight(digest.tonight, lang));
  root.append(renderShareBar(digest, lang));
}
```

- [ ] **Step 5: Verify existing fixtures still render (smoke)**

Run: `node --test test/i18n.test.js`
Expected: PASS (unchanged — render.js has no unit test; the full DOM check is the browser scenario in Task 12). Confirm the file parses:
Run: `node --check site/assets/render.js`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add site/assets/render.js
git commit -m "feat: thread language through render.js via i18n helpers"
```

---

### Task 3: Language toggle module + page wiring

**Files:**
- Create: `site/assets/lang.js`
- Modify: `site/index.html`, `site/arhiva.html`
- (No unit test — DOM module like `theme.js`; verified in the Task 12 browser scenario.)

**Interfaces:**
- Produces:
  - `currentLang()` → `'ro' | 'en'` (saved value or `'ro'`).
  - `mountLangToggle(container, onChange)` — appends a button; on click flips lang, persists, sets `document.documentElement.lang`, calls `onChange(newLang)`. Idempotent.

- [ ] **Step 1: Write `lang.js`**

```js
// site/assets/lang.js
const LANG_KEY = 'lang';

/** The active language: a validated saved choice, else Romanian (the default). */
export function currentLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'ro' || saved === 'en') return saved;
  } catch (_) {}
  return 'ro';
}

/**
 * Mounts a RO/EN toggle button in `container`. On change it persists the choice,
 * updates <html lang>, and calls onChange(newLang). Idempotent: a second call on
 * the same container is a no-op.
 */
export function mountLangToggle(container, onChange) {
  if (container.querySelector('.lang-toggle')) return;

  const btn = document.createElement('button');
  btn.className = 'lang-toggle';
  btn.setAttribute('aria-label', 'Change language / Schimbă limba');

  function sync() {
    const lang = currentLang();
    // Button shows the language you'd switch TO.
    btn.textContent = lang === 'ro' ? 'EN' : 'RO';
    btn.setAttribute('aria-pressed', String(lang === 'en'));
    document.documentElement.lang = lang;
  }

  btn.addEventListener('click', () => {
    const next = currentLang() === 'ro' ? 'en' : 'ro';
    try { localStorage.setItem(LANG_KEY, next); } catch (_) {}
    sync();
    onChange?.(next);
  });

  container.append(btn);
  sync();
}
```

- [ ] **Step 2: Add the `<html lang>` bootstrap + toggle mount to `index.html`**

In `index.html`, extend the existing inline head bootstrap script (the theme one) to also set lang before paint:

```html
  <script>
    try {
      var t = localStorage.getItem('theme');
      if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
      var l = localStorage.getItem('lang');
      document.documentElement.lang = (l === 'ro' || l === 'en') ? l : 'ro';
    } catch (e) {}
  </script>
```

Replace the topbar mount + digest load script block with one that hoists `digest` to the closure and re-renders on language change:

```html
  <script type="module">
    import { mountToggle } from './assets/theme.js';
    import { mountLangToggle, currentLang } from './assets/lang.js';
    import { renderDigest, loadDigest } from './assets/render.js';

    const topbar = document.getElementById('topbar');
    mountToggle(topbar);

    const app = document.getElementById('app');
    let currentDigest = null;

    mountLangToggle(topbar, (lang) => {
      if (currentDigest) renderDigest(app, currentDigest, lang);
    });

    loadDigest('data/latest.json')
      .then((digest) => {
        currentDigest = digest;
        renderDigest(app, digest, currentLang());
      })
      .catch((error) => {
        app.replaceChildren();
        app.append(Object.assign(document.createElement('p'), {
          className: 'empty-state',
          textContent: `Digestul de azi nu e încă gata. (${error.message})`,
        }));
      });
  </script>
```

(Delete the old two separate `<script type="module">` blocks this replaces.)

- [ ] **Step 3: Add the bootstrap + toggle mount to `arhiva.html`**

Extend `arhiva.html`'s inline head bootstrap the same way (add the `lang` lines). Then wire the toggle to re-render the currently shown day. In the page's module script, track the shown date and pass `currentLang()` into `renderDigest`:

```js
    import { renderDigest, loadDigest } from './assets/render.js';
    import { mountToggle } from './assets/theme.js';
    import { mountLangToggle, currentLang } from './assets/lang.js';

    const meta = document.querySelector('.meta');
    mountToggle(meta);

    const list = document.getElementById('archive-list');
    const digestRoot = document.getElementById('digest');
    let shownDate = null;
    let shownDigest = null;

    mountLangToggle(meta, () => {
      if (shownDigest) renderDigest(digestRoot, shownDigest, currentLang());
    });

    const dateFmt = new Intl.DateTimeFormat('ro-RO', {
      timeZone: 'Europe/Bucharest', weekday: 'long', day: 'numeric', month: 'long',
    });

    async function showDay(date) {
      try {
        const digest = await loadDigest(`data/${date}.json`);
        shownDate = date;
        shownDigest = digest;
        renderDigest(digestRoot, digest, currentLang());
        digestRoot.scrollIntoView({ behavior: 'smooth' });
      } catch {
        digestRoot.replaceChildren(Object.assign(document.createElement('p'), {
          className: 'empty-state',
          textContent: `Nu există digest pentru ${date}.`,
        }));
      }
    }
```

(The archive-list label `dateFmt` stays Romanian — it's the picker, not the digest; leaving it RO is acceptable. The rest of the existing arhiva script — manifest load, list build, hash handling — is unchanged.)

- [ ] **Step 4: Add minimal toggle styling**

In `site/assets/style.css`, add a rule mirroring `.theme-toggle` (find that selector and append a sibling):

```css
.lang-toggle {
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  background: none;
  border: 1px solid var(--muted);
  border-radius: 6px;
  color: var(--muted);
  cursor: pointer;
  padding: 2px 8px;
  margin-left: 8px;
}
```

(Match the existing toggle's visual weight; adjust to the real `.theme-toggle` rule if it differs.)

- [ ] **Step 5: Verify both pages parse**

Run: `node --check site/assets/lang.js`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add site/assets/lang.js site/index.html site/arhiva.html site/assets/style.css
git commit -m "feat: RO/EN language toggle with localStorage + per-page re-render"
```

---

### Task 4: English narration prompts + schema (narration-core)

**Files:**
- Modify: `pipeline/narration-core.js`
- Modify: `pipeline/narrate.js` (add `responseSchemaEn`)
- Test: `test/narration-core.test.js` (create)

**Interfaces:**
- Produces (narration-core.js):
  - `SYSTEM_PROMPT_EN` (string) — English voice prompt.
  - `narrationSchemaEn` (zod) — same structure as `narrationSchema`, `alarm` enum `['stay up', 'read in the morning']`.
  - `CRITIQUE_SYSTEM_PROMPT_EN` (string) — English-native idiom reviewer.
  - `buildRewriteSystemPromptEn(critique)` → string.
  - `localizeProse(field, lang)` — server-side twin of the site `localize` (string passthrough / `{ro,en}` pick with ro fallback).
- Produces (narrate.js): `responseSchemaEn` — Gemini server-side schema mirroring `narrationSchemaEn` (alarm enum swapped).

- [ ] **Step 1: Write the failing test**

```js
// test/narration-core.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  narrationSchemaEn, SYSTEM_PROMPT_EN, CRITIQUE_SYSTEM_PROMPT_EN,
  buildRewriteSystemPromptEn, localizeProse,
} from '../pipeline/narration-core.js';

test('narrationSchemaEn accepts the English alarm enum', () => {
  const ok = {
    headline: 'h', summary: 's',
    matches: [{ id: 1, pill: 'p', drama: 3 }],
    tonight: [{ id: 2, alarm: 'stay up', why: 'w' }],
  };
  assert.doesNotThrow(() => narrationSchemaEn.parse(ok));
});

test('narrationSchemaEn rejects the Romanian alarm enum', () => {
  const bad = {
    headline: 'h', summary: 's', matches: [],
    tonight: [{ id: 2, alarm: 'merită văzut', why: 'w' }],
  };
  assert.throws(() => narrationSchemaEn.parse(bad));
});

test('English prompts are English and reference the alarm enum', () => {
  assert.match(SYSTEM_PROMPT_EN, /English/i);
  assert.match(SYSTEM_PROMPT_EN, /stay up/);
  assert.match(SYSTEM_PROMPT_EN, /read in the morning/);
  assert.match(CRITIQUE_SYSTEM_PROMPT_EN, /English/i);
});

test('buildRewriteSystemPromptEn embeds the critique and the English voice', () => {
  const out = buildRewriteSystemPromptEn('note: avoid "thrilling encounter"');
  assert.match(out, /thrilling encounter/);
  assert.match(out, /English/i);
});

test('localizeProse mirrors the site localize', () => {
  assert.equal(localizeProse('x', 'en'), 'x');
  assert.equal(localizeProse({ ro: 'r', en: 'e' }, 'en'), 'e');
  assert.equal(localizeProse({ ro: 'r' }, 'en'), 'r');
  assert.equal(localizeProse(null, 'ro'), '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/narration-core.test.js`
Expected: FAIL — exports not defined.

- [ ] **Step 3: Add the English prompts, schema, and helper to `narration-core.js`**

Append to `pipeline/narration-core.js`:

```js
export const SYSTEM_PROMPT_EN = `You write the morning digest for a group of friends following the 2026
World Cup. You are not a news site — you are the friend who watched everything and tells the story
over coffee, with dry wit and fine little jabs. Impeccable, natural English football idiom.

THE VOICE:
- Specific, never generic. Every sentence must hook onto a fact from the data: a minute, a scorer,
  a league-table position, a card. THE TEST: before writing a sentence, ask "could this be written
  about any 0-0 in history?" If yes, it is bad — throw it out and write one only THIS match allows
  (a name, a minute, a number that stings).
- One good thing said concretely beats three generalities. Do not pad — if a flat match gives you
  nothing, say little and move on; silence beats cliché.
- Dry humor, gentle irony, the occasional comic exaggeration. Be a little mean to the big teams that
  embarrass themselves and tender toward the minnows that bite. YOU ARE ALLOWED to be funny — that is
  the point, not a risk to avoid. Humor tools (apply them to YOUR day's facts — do not copy phrasings,
  find the image that fits the match in front of you):
    • turn a number or fact against whoever owns it (a record that backfires, an "achievement" that is
      really a disgrace);
    • highlight the gap between ambition and result with faint praise ("a masterclass in efficiency")
      said about a failure;
    • a concrete, physical image instead of an abstraction ("flew home with three suitcases of regret"
      beats "it was a disappointing evening").
  These are TOOLS, not ready-made lines: if you write the example above verbatim, you got it wrong —
  build your joke from today's match.
- At most ONE exclamation mark in the whole digest. A full stop hits harder.
- BANNED sports-portal language: "a thrilling encounter", "emotions running high", "made their
  intentions clear", "announced their candidacy", "proved that", "a footballing feast", "a statement
  win". Anything that reads like a press release — out.
- The headline is like a short WhatsApp-group message that makes you open the link: wordplay, a
  concrete image, a jab. Not an announcement.

FACT RULES (strict):
1. Use ONLY the facts provided: scores, scorers, minutes, cards, standings. Invent nothing — no goals,
   no stats, no head-to-head history. Do not name players who are not in the scorer/card list you were
   given (not even famous ones) — for upcoming matches you only have the team names and the kickoff time.
2. Speak about qualification carefully ("made life hard for themselves", "can sleep easy") — never exact
   conditions like "they qualify if X and Y".

FORMAT:
3. "pill" = what you tell your friend about this match over coffee, in at most 3 sentences: a telling
   observation, a jab, the image that stuck — NOT a league-table bulletin. Drop the table position only
   if you also have a witticism to go with it. Remember what a living person would recount: the 89th-minute
   goal, the keeper made to look foolish, the favorite that stumbled — not the table.
4. "drama" = 1–5 (1 = a stroll, 5 = madness with swings). A 4-0 with no story is 1-2; a decisive goal
   after the 85th, red cards, comebacks = 4-5.
5. "tonight": before you decide "alarm", THINK in two steps, per match:
   (a) THE TIME (from "kickoffEEST", Romanian local time): a match starting early evening (up to about
       22:00) you catch without sacrificing anything — there is no "lost sleep", so "stay up" makes no
       sense for it however good it is. Sleep only starts to hurt from around midnight on (00:00–06:00);
       that is the only window where "stay up" means anything.
   (b) THE STAKES, judged from the FIFA ranking provided ("homeRank"/"awayRank", world position; lower =
       stronger): a match between two top sides (both under ~20) or a balanced duel is strong; a top side
       against a much weaker one (a big ranking gap, e.g. 9 vs 60) is lopsided — probably a formality, low
       stakes, do not recommend it at night unless a genuine upset is brewing. If the rank is missing
       (null), do not invent a hierarchy — judge only on time and what is at stake in the group.
       The rank is a JUDGMENT TOOL, not display text: do NOT write "ranked Nth in the world" or "(Nth)" in
       "why". HIDE THE NUMBER, NOT THE TEAMS — every "why" always names who plays (both teams by name);
       translate the gap in value into words ("big favorites", "well above", "two equal forces"), never a
       number. A sentence without the team names is a failure — rewrite it with who takes the field.
   Only then: "stay up" = a match that is BOTH late (from about 00:00 on) AND genuinely worth the sacrifice
   by the test above. If it is early, it is "read in the morning" however good (you see it at a normal hour
   anyway). If it is late but weak or lopsided, also "read in the morning". Be stingy with "stay up": on a
   normal night there are zero or one.
   "why" = one sentence linking the time EXPLICITLY to the stakes (you may use team strength, not bare
   numbers), e.g. "worth the alarm: 01:00, but it is two top sides fighting for first". Do not say "stay up"
   for a 20:00 match — that is a contradiction.
   MANDATORY VARIATION: the few "why" lines on the same night must NOT repeat the same formula. If you have
   already written "you'll catch the score over coffee" / "watch the highlights tomorrow", find ANOTHER way
   to say "not worth the night" for the next ones. Four identical lines is a failure.
6. "headline" = at most 70 characters. "summary" = exactly 2 sentences.
7. A night with no matches: headline + summary about what is coming, same tone, no fanfare.

MATCH DETAILS (use them, do not invent them):
- For each goal you get, when present: how it was scored ("bodyPart": header / right foot / left foot),
  from where ("placement": from outside the box etc.), whether it was a "penalty" or "ownGoal", and who
  assisted ("assist"). Weave them in naturally: "headed in from inside the box", "from the penalty spot",
  "own goal", "set up by X". Use a detail ONLY if present (non-null); pass over what is missing — do not
  deduce, do not invent.
- THE FOOT (left/right) is the least interesting detail. Mention it at most ONCE in the whole match, and
  only when the foot really is the story (a stunning strike with the weaker foot, a long-range volley). For
  a header, a penalty, a tap-in or any ordinary goal, the foot is noise: stay quiet. "Headed" does NOT fall
  under this limit — it changes the image of the goal.
- "stats" are the match numbers per team (possession, shots, shots on target, corners, saves, fouls). They
  are the last resort, not the first: cite at most ONE number for a given match, and only when the number
  CONTRADICTS the result — a side that dominated and lost or drew, a keeper who held a point alone. When the
  score already says it all, no number. At a story-less 0-0, do not force a stats angle.
- These details are FACTS you were given, not text to copy. Not a single word of Romanian.`;

export const narrationSchemaEn = z.object({
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
      alarm: z.enum(['stay up', 'read in the morning']),
      why: z.string().min(1),
    }),
  ),
});

export const CRITIQUE_SYSTEM_PROMPT_EN = `You are a native English football writer with a fine ear for
language. You receive a football digest written by a colleague. Your job: find everything that sounds
translated, stilted, or simply unnatural in English football idiom. Do NOT rewrite it yourself. Do NOT
comment on the facts (scores, scorers, minutes) — those are correct and fixed. Do NOT comment on the
humor or the structure of the jokes — those stay. Look ONLY at the language:
- awkward calques or non-idiomatic constructions
- clichés that slipped in ("thrilling encounter", "made their intentions clear", "a statement win")
- truncated country names — always write the full team name ("Ivory Coast", not "Ivory"; "Cape Verde",
  not "Cape")
- logically impossible constructions ("opened the scoring twice" — the scoring is opened once; the second
  time is "scored again")
- odd prepositions, wrong word order, anything that would sound strange said aloud over coffee with friends
List each problem on its own line: the exact quote + how a native would say it. If a sentence is already
good, leave it alone. Be concrete and brief.`;

export function buildRewriteSystemPromptEn(critique) {
  return `${SYSTEM_PROMPT_EN}

A NATIVE ENGLISH EDITOR reviewed your previous text and noted where the language sounds translated or
unnatural. Rewrite the digest applying EXACTLY these language notes. Keep the facts, the tone, the humor,
and the punchy headline intact — change ONLY the flagged phrasings (and similar ones you spot yourself).

If the facts message contains SUCCESSFUL-TONE EXAMPLES, those remain the tone target: keep that level of
humor, rhythm and concreteness — do not drop below it while fixing the language. The editor's notes:
${critique}`;
}

/**
 * Server-side twin of the site's localize: a plain string is legacy RO-only and
 * passes through; an object is per-language with an ro fallback. Used by
 * recentProseBefore so the anti-recycling avoid-list stays plain strings.
 */
export function localizeProse(field, lang) {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  return field[lang] ?? field.ro ?? '';
}
```

- [ ] **Step 4: Add `responseSchemaEn` to `narrate.js`**

In `pipeline/narrate.js`, after the existing `responseSchema` export, add the EN mirror:

```js
// Gemini structured-output schema for English narration: identical to
// responseSchema but with the English alarm enum.
export const responseSchemaEn = {
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
          alarm: { type: 'STRING', enum: ['stay up', 'read in the morning'] },
          why: { type: 'STRING' },
        },
      },
    },
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/narration-core.test.js`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add pipeline/narration-core.js pipeline/narrate.js test/narration-core.test.js
git commit -m "feat: English voice prompts, EN narration schema, localizeProse helper"
```

---

### Task 5: Language-parameterize the polish ladder

**Files:**
- Modify: `pipeline/narration-polish.js`
- Test: `test/narration-polish.test.js` (extend)

**Interfaces:**
- Consumes: Task 4 prompts.
- Produces: `polishedNarration({ model, userMessage, draftEngine, critiqueEngine, systemPrompt, critiquePrompt, buildRewritePrompt })`. The three prompt params default to the RO trio (`SYSTEM_PROMPT`, `CRITIQUE_SYSTEM_PROMPT`, `buildRewriteSystemPrompt`), so existing callers are unaffected.

- [ ] **Step 1: Write the failing test**

Add to `test/narration-polish.test.js`:

```js
import { SYSTEM_PROMPT_EN, CRITIQUE_SYSTEM_PROMPT_EN } from '../pipeline/narration-core.js';

test('polishedNarration uses injected EN prompts for draft and critique', async () => {
  const seen = {};
  const draftEngine = async ({ systemPrompt }) => {
    seen.draftSystem = systemPrompt;
    return { headline: 'h', summary: 's', matches: [], tonight: [] };
  };
  const critiqueEngine = async ({ systemPrompt }) => {
    seen.critiqueSystem = systemPrompt;
    return ''; // empty critique → ship draft, no rewrite
  };
  const { narration, polished } = await polishedNarration({
    model: 'm', userMessage: 'facts',
    draftEngine, critiqueEngine,
    systemPrompt: SYSTEM_PROMPT_EN,
    critiquePrompt: CRITIQUE_SYSTEM_PROMPT_EN,
  });
  assert.equal(seen.draftSystem, SYSTEM_PROMPT_EN);
  assert.equal(seen.critiqueSystem, CRITIQUE_SYSTEM_PROMPT_EN);
  assert.equal(narration.headline, 'h');
  assert.equal(polished, false);
});
```

(Keep the existing `polishedNarration` tests — they must still pass with the RO defaults. Check the top of the file already imports `polishedNarration`, `test`, `assert`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/narration-polish.test.js`
Expected: FAIL — `systemPrompt`/`critiquePrompt` are ignored (draft uses the hardcoded RO `SYSTEM_PROMPT`).

- [ ] **Step 3: Parameterize `polishedNarration`**

Replace the function in `pipeline/narration-polish.js` (and update imports to include the rewrite builder default):

```js
import { callClaude, callClaudeText } from './claude-engine.js';
import {
  SYSTEM_PROMPT,
  CRITIQUE_SYSTEM_PROMPT,
  buildRewriteSystemPrompt,
  narrationToReviewText,
} from './narration-core.js';

/**
 * @returns { narration, polished } — polished is true only when the rewrite
 * succeeded. The prompt trio (draft system prompt, critique prompt, rewrite
 * builder) defaults to the Romanian set; the EN pass injects the English trio.
 */
export async function polishedNarration({
  model, userMessage,
  draftEngine = callClaude,
  critiqueEngine = callClaudeText,
  systemPrompt = SYSTEM_PROMPT,
  critiquePrompt = CRITIQUE_SYSTEM_PROMPT,
  buildRewritePrompt = buildRewriteSystemPrompt,
}) {
  // The draft await is intentionally OUTSIDE the try: a draft failure must
  // propagate so getNarration can fall back to Gemini. Only polish-stage
  // failures are swallowed (the draft is already shippable). Do not wrap this.
  const draft = await draftEngine({ model, userMessage, systemPrompt });
  let stage = 'critique';
  try {
    const critique = await critiqueEngine({
      model,
      userMessage: narrationToReviewText(draft),
      systemPrompt: critiquePrompt,
    });
    if (!critique.trim()) return { narration: draft, polished: false };

    stage = 'rewrite';
    const narration = await draftEngine({
      model,
      userMessage,
      systemPrompt: buildRewritePrompt(critique),
    });
    return { narration, polished: true };
  } catch (error) {
    console.warn(`Idiom polish failed at ${stage} (${error.message}). Shipping the unpolished draft.`);
    return { narration: draft, polished: false };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/narration-polish.test.js`
Expected: PASS (existing RO tests + the new EN-injection test).

- [ ] **Step 5: Commit**

```bash
git add pipeline/narration-polish.js test/narration-polish.test.js
git commit -m "feat: parameterize polish ladder prompts (RO default, EN injectable)"
```

---

### Task 6: EN teaser variant

**Files:**
- Modify: `pipeline/teaser.js`
- Test: `test/teaser.test.js` (extend)

**Interfaces:**
- Produces: `buildTeaserEn({ headline, matchCount, siteUrl })` → string. Mirrors `buildTeaser` with English pluralization.

- [ ] **Step 1: Write the failing test**

Add to `test/teaser.test.js`:

```js
import { buildTeaserEn } from '../pipeline/teaser.js';

test('buildTeaserEn pluralizes matches in English', () => {
  assert.equal(
    buildTeaserEn({ headline: 'Big night', matchCount: 3, siteUrl: 'https://x/' }),
    '⚽ Big night · 3 matches overnight, with video highlights\nhttps://x/',
  );
});

test('buildTeaserEn handles one match and none', () => {
  assert.match(buildTeaserEn({ headline: 'H', matchCount: 1, siteUrl: 'u' }), /1 match overnight/);
  assert.match(buildTeaserEn({ headline: 'H', matchCount: 0, siteUrl: 'u' }), /no matches overnight/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/teaser.test.js`
Expected: FAIL — `buildTeaserEn` not exported.

- [ ] **Step 3: Add the EN variant**

Append to `pipeline/teaser.js`:

```js
function gamesLabelEn(matchCount) {
  if (matchCount === 0) return 'no matches overnight';
  const matches = matchCount === 1 ? '1 match' : `${matchCount} matches`;
  return `${matches} overnight, with video highlights`;
}

export function buildTeaserEn({ headline, matchCount, siteUrl }) {
  return `⚽ ${headline} · ${gamesLabelEn(matchCount)}\n${siteUrl}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/teaser.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/teaser.js test/teaser.test.js
git commit -m "feat: English WhatsApp teaser variant"
```

---

### Task 7: `getNarration` EN branch (run.js)

**Files:**
- Modify: `pipeline/run.js`
- Test: `test/narrator-select.test.js` (extend)

**Interfaces:**
- Consumes: Task 4 (`SYSTEM_PROMPT_EN`, `responseSchemaEn`, EN polish prompts), Task 5 (parameterized `polishedNarration`).
- Produces: `getNarration(...)` returns `{ narration, narrator, en }` where `en` is `{ narration, narrator } | null`. The RO `{ narration, narrator }` is exactly as today (additive change).

- [ ] **Step 1: Write the failing test**

Add to `test/narrator-select.test.js`:

```js
test('getNarration produces an EN narration alongside RO (opus)', async (t) => {
  t.after(() => { delete process.env.NARRATOR; });
  process.env.NARRATOR = 'opus';
  const EN_OUT = { headline: 'EN title', summary: 'Two sentences. Really two.', matches: [], tonight: [] };
  // claudeEngine is called twice: once for RO (SYSTEM_PROMPT), once for EN (SYSTEM_PROMPT_EN).
  const claudeEngine = async ({ systemPrompt }) =>
    /English/i.test(systemPrompt) ? EN_OUT : OPUS_OUT;
  const result = await getNarration(facts, { fixtures: fixturesDir(), recentProse: [], claudeEngine });
  assert.equal(result.narrator, 'opus');
  assert.equal(result.narration.headline, 'Titlu scris de Opus');
  assert.equal(result.en.narrator, 'opus');
  assert.equal(result.en.narration.headline, 'EN title');
});

test('getNarration: EN failure leaves en null, RO still ships', async (t) => {
  t.after(() => { delete process.env.NARRATOR; });
  process.env.NARRATOR = 'opus';
  const claudeEngine = async ({ systemPrompt }) => {
    if (/English/i.test(systemPrompt)) throw new Error('EN engine down');
    return OPUS_OUT;
  };
  const result = await getNarration(facts, { fixtures: fixturesDir(), recentProse: [], claudeEngine });
  assert.equal(result.narration.headline, 'Titlu scris de Opus');
  assert.equal(result.en, null);
});

test('getNarration (gemini single-pass) also produces EN', async (t) => {
  t.after(() => { delete process.env.NARRATOR; });
  delete process.env.NARRATOR;
  // Offline fixtures: RO from narration.json, EN from narration.en.json (Task 9).
  const result = await getNarration(facts, { fixtures: fixturesDir(), recentProse: [] });
  assert.equal(result.narrator, 'gemini');
  assert.ok(result.en, 'EN narration present offline');
  assert.equal(result.en.narrator, 'gemini');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/narrator-select.test.js`
Expected: FAIL — `result.en` is undefined.

- [ ] **Step 3: Add the EN imports to run.js**

In `pipeline/run.js`, extend the narration-core import and add the EN narrate entry:

```js
import {
  SYSTEM_PROMPT, SYSTEM_PROMPT_EN, buildUserMessage, localizeProse,
  CRITIQUE_SYSTEM_PROMPT_EN, buildRewriteSystemPromptEn,
} from './narration-core.js';
import { narrate, narrateEn } from './narrate.js';
```

(Add `narrateEn` to `narrate.js` — see Step 4.)

- [ ] **Step 4: Add `narrateEn` to narrate.js**

In `pipeline/narrate.js`, import the EN system prompt and add an EN entry point next to `narrate`:

```js
import { SYSTEM_PROMPT, SYSTEM_PROMPT_EN, narrationSchema, narrationSchemaEn, buildUserMessage, normalizeSteer } from './narration-core.js';
```

Add the validate hookup: the resilient caller validates with `narrationSchema` when `schema` is set. To validate EN against `narrationSchemaEn`, add an explicit EN function that calls the transport with the EN server schema and validates client-side. Simplest: add

```js
/**
 * Single-pass English narration. Same transport/ladder as narrate(), but with
 * the English voice prompt and English response schema.
 */
export async function narrateEn(facts, { apiKey, model = DEFAULT_MODEL, recentProse = [], steer = null, gold = [], sleep = realSleep } = {}) {
  const userMessage = buildUserMessage(facts, recentProse, steer, gold);
  return callGeminiResilient({
    apiKey, model, systemPrompt: SYSTEM_PROMPT_EN, userMessage,
    schema: responseSchemaEn, validateWith: narrationSchemaEn, sleep,
  });
}
```

Then in `callGeminiResilient` and `callModelWithBackoff`, accept an optional `validateWith` that overrides the default `narrationSchema`:

```js
export async function callGeminiResilient({ apiKey, model = DEFAULT_MODEL, systemPrompt, userMessage, schema = null, validateWith = narrationSchema, sleep = realSleep }) {
  const validate = schema ? (text) => validateWith.parse(JSON.parse(text)) : null;
  // ...rest unchanged...
}
```

(The existing RO callers pass no `validateWith`, so they default to `narrationSchema` — behavior unchanged.)

- [ ] **Step 5: Add EN engines for the polish path to gemini-engine.js**

In `pipeline/gemini-engine.js`, add EN draft/critique engines mirroring the RO ones but with the EN response schema:

```js
import { callGeminiResilient, responseSchema, responseSchemaEn } from './narrate.js';
import { narrationSchemaEn } from './narration-core.js';

export async function callGeminiNarrationEn({ model, userMessage, systemPrompt }) {
  return callGeminiResilient({
    apiKey: requireKey(), model: model || undefined, systemPrompt, userMessage,
    schema: responseSchemaEn, validateWith: narrationSchemaEn,
  });
}
// callGeminiText (plain text critique) is language-neutral; reuse it for EN.
```

- [ ] **Step 6: Add the EN branch to `getNarration`**

Refactor `getNarration` so the existing logic computes the RO result unchanged, then append an EN pass. Add EN engine params to the signature (injectable for tests), and after computing `{ narration, narrator }` (the current return), build `en`:

```js
export async function getNarration(facts, {
  fixtures, recentProse, steer, gold = [],
  claudeEngine = callClaude,
  polishEngine = polishedNarration,
  geminiDraftEngine = callGeminiNarration,
  geminiCritiqueEngine = callGeminiText,
  geminiDraftEngineEn = callGeminiNarrationEn,
} = {}) {
  const ro = await getRoNarration(facts, { /* existing params */ });
  const en = await getEnNarration(facts, {
    fixtures, recentProse, steer, gold,
    claudeEngine, polishEngine, geminiDraftEngineEn, geminiCritiqueEngine,
  }).catch((error) => {
    console.warn(`English narration failed (${error.message}). Shipping Romanian only.`);
    return null;
  });
  return { ...ro, en };
}
```

Extract the **current body** of `getNarration` verbatim into `getRoNarration` (returning `{ narration, narrator }`) — no logic change. Then add `getEnNarration`, mirroring the engine selection but with EN prompts/schema and the EN offline fixture:

```js
async function getEnNarration(facts, {
  fixtures, recentProse, steer, gold,
  claudeEngine, polishEngine, geminiDraftEngineEn, geminiCritiqueEngine,
}) {
  const mode = process.env.NARRATOR;

  if (fixtures) {
    // Offline: read narration.en.json; if absent, no EN this run.
    const cannedPath = path.join(fixtures, 'narration.en.json');
    if (!existsSync(cannedPath)) return null;
    return { narration: await readJson(cannedPath), narrator: 'gemini' };
  }

  const userMessage = buildUserMessage(facts, recentProse, steer, gold);

  if (mode === 'gemini-polish') {
    const model = process.env.GEMINI_MODEL || undefined;
    const { narration, polished } = await polishEngine({
      model, userMessage,
      draftEngine: geminiDraftEngineEn, critiqueEngine: geminiCritiqueEngine,
      systemPrompt: SYSTEM_PROMPT_EN,
      critiquePrompt: CRITIQUE_SYSTEM_PROMPT_EN,
      buildRewritePrompt: buildRewriteSystemPromptEn,
    });
    return { narration, narrator: polished ? 'gemini-polish' : 'gemini' };
  }

  if (mode !== 'opus' && mode !== 'opus-polish') {
    return {
      narration: await narrateEn(facts, {
        apiKey: requireEnv('GEMINI_API_KEY'),
        model: process.env.GEMINI_MODEL || undefined,
        recentProse, steer, gold,
      }),
      narrator: 'gemini',
    };
  }

  const model = process.env.CLAUDE_MODEL || 'opus';
  if (mode === 'opus-polish') {
    const { narration, polished } = await polishEngine({
      model, userMessage, draftEngine: claudeEngine,
      systemPrompt: SYSTEM_PROMPT_EN,
      critiquePrompt: CRITIQUE_SYSTEM_PROMPT_EN,
      buildRewritePrompt: buildRewriteSystemPromptEn,
    });
    return { narration, narrator: polished ? 'opus-polish' : 'opus' };
  }
  return { narration: await claudeEngine({ model, userMessage, systemPrompt: SYSTEM_PROMPT_EN }), narrator: 'opus' };
}
```

Add the imports at the top of run.js: `callGeminiNarrationEn` from `./gemini-engine.js`.

Note: EN has no further Gemini fallback like RO's `gemini-fallback` — an EN total failure returns `null` via the `.catch` above (best-effort).

- [ ] **Step 7: Run tests to verify they pass**

Run: `node --test test/narrator-select.test.js`
Expected: PASS — all existing tests (RO unchanged) plus the three new EN tests. (The `getNarration (gemini single-pass) also produces EN` test depends on the `narration.en.json` fixture from Task 9; if running tasks in order, create that fixture first or expect this one test to fail until Task 9. To keep TDD green, **do Task 9 before Step 7's full run**, or temporarily assert `result.en === null` and tighten after Task 9.)

- [ ] **Step 8: Commit**

```bash
git add pipeline/run.js pipeline/narrate.js pipeline/gemini-engine.js test/narrator-select.test.js
git commit -m "feat: parallel English narration in getNarration (best-effort, RO unaffected)"
```

---

### Task 8: Digest assembly into `{ro,en}` + RO-pinned OG/teaser/email + recentProse localize

**Files:**
- Modify: `pipeline/run.js` (`main`, `recentProseBefore`, `withoutGold`)
- Test: `test/run.test.js` (extend)

**Interfaces:**
- Consumes: Task 7 (`getNarration` `{narration, narrator, en}`), Task 6 (`buildTeaserEn`), Task 4 (`localizeProse`).
- Produces: stored digest with `headline`/`summary`/`pill`/`alarm`/`why`/`teaser` as `{ro,en}` (en omitted when EN absent), `narrator` as `{ro,en}`; OG image, OG meta tags, teaser-for-email, and `setOutput('headline'/'summary'/'narrator')` all read the flat RO value.

- [ ] **Step 1: Write the failing test**

Add to `test/run.test.js` a test that runs the pipeline offline with both fixtures present and asserts the bilingual digest shape. (Follow the existing `run.test.js` pattern for invoking `main`/the offline run; if `run.test.js` shells out to `node pipeline/run.js --fixtures ...`, mirror that.) Minimum assertions:

```js
// after an offline run with test/fixtures (which now includes narration.en.json):
const digest = JSON.parse(readFileSync(path.join(outDir, '2026-06-12.json'), 'utf8'));
assert.equal(typeof digest.headline, 'object');
assert.ok(digest.headline.ro && digest.headline.en);
assert.equal(typeof digest.narrator, 'object');
assert.ok(digest.matches.every((m) => typeof m.pill === 'object'));
assert.ok(digest.tonight.every((t) => typeof t.alarm === 'object' && typeof t.why === 'object'));
assert.ok(digest.teaser.ro && digest.teaser.en);
```

(If `run.test.js` does not yet exist as an offline-run harness, add one using the same `fixtureFetch` approach as `gatherFacts`, or invoke via `child_process` like other integration tests. Use `--out <tmpdir>` so writes are isolated.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/run.test.js`
Expected: FAIL — prose fields are still flat strings.

- [ ] **Step 3: Localize the recent-prose collection**

In `recentProseBefore`, localize each field to RO with passthrough (import `localizeProse` is already added in Task 7):

```js
async function recentProseBefore(dataDir, date, days = 3) {
  if (!existsSync(dataDir)) return [];
  const files = (await readdir(dataDir))
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .map((name) => name.replace('.json', ''))
    .filter((d) => d < date)
    .sort()
    .slice(-days);

  const prose = [];
  for (const d of files) {
    const digest = await readJson(path.join(dataDir, `${d}.json`));
    prose.push(localizeProse(digest.headline, 'ro'), localizeProse(digest.summary, 'ro'));
    for (const m of digest.matches ?? []) prose.push(localizeProse(m.pill, 'ro'));
    for (const t of digest.tonight ?? []) prose.push(localizeProse(t.why, 'ro'));
  }
  return prose.filter(Boolean);
}
```

(`withoutGold` compares against gold `.text` strings — now that `recentProse` holds localized RO strings again, it works unchanged. No edit needed there beyond confirming.)

- [ ] **Step 4: Build the bilingual digest in `main`**

In `main`, after obtaining the narration result, keep the RO narration object as `narration` (feeds OG/teaser/email) and pull EN. The reuse path returns RO-shaped `{narration}` + `existing` carries EN already; handle both. Replace the assembly:

```js
  // `narration` (RO) and `enNarration` (EN | null). Reuse path supplies both
  // from the stored digest; fresh path from getNarration.
  let narration = null;       // RO narration object (flat strings) — feeds OG/teaser/email
  let enNarration = null;     // EN narration object | null
  let narratorRo = null;
  let narratorEn = null;
  let reused = false;

  if (!args.reNarrate && existing && (!existing.factsHash || existing.factsHash === hash)) {
    const reusedRo = reuseNarration(existing, facts);
    if (reusedRo) {
      narration = reusedRo;
      narratorRo = localizeNarrator(existing.narrator, 'ro') ?? 'gemini';
      // EN reuse: only if the stored digest already had EN prose for all needed ids.
      enNarration = reuseNarrationEn(existing, facts);   // null if any en missing
      narratorEn = enNarration ? (localizeNarrator(existing.narrator, 'en') ?? null) : null;
      reused = true;
    }
  }

  if (reused) {
    console.log('facts unchanged, prose reused');
  } else {
    const gold = await loadGoldSafe();
    const recentProse = args.fixtures ? [] : withoutGold(await recentProseBefore(dataDir, date), gold);
    const result = await getNarration(factsForNarration, {
      fixtures: args.fixtures, recentProse, steer: args.steer, gold,
    });
    narration = result.narration;
    narratorRo = result.narrator;
    enNarration = result.en?.narration ?? null;
    narratorEn = result.en?.narrator ?? null;
  }
```

Add two small helpers near the top of run.js:

```js
/** Reads a (possibly legacy-string) narrator field for one language. */
function localizeNarrator(narrator, lang) {
  if (narrator == null) return null;
  if (typeof narrator === 'string') return lang === 'ro' ? narrator : null;
  return narrator[lang] ?? null;
}

/**
 * Rebuilds EN narration from a stored bilingual digest, mirroring reuseNarration
 * but reading the .en side of each prose field. Returns null when any required
 * EN field is missing (so a RO-only stored day reuses RO and leaves EN absent).
 */
export function reuseNarrationEn(stored, facts) {
  const enOrNull = (field) => (field && typeof field === 'object' && field.en != null ? field.en : null);
  const headline = enOrNull(stored.headline);
  const summary = enOrNull(stored.summary);
  if (!headline || !summary) return null;

  const storedMatches = new Map((stored.matches ?? []).map((m) => [m.id, m]));
  const matches = [];
  for (const m of facts.finished) {
    const s = storedMatches.get(m.id);
    const pill = enOrNull(s?.pill);
    if (!pill) return null;
    matches.push({ id: m.id, pill, drama: s.drama ?? 1 });
  }

  const tonightById = new Map();
  const tonightByTeams = new Map();
  for (const t of stored.tonight ?? []) {
    if (t.id != null) tonightById.set(t.id, t);
    tonightByTeams.set(`${t.home}|${t.away}`, t);
  }
  const tonight = [];
  for (const f of facts.tonight) {
    const s = tonightById.get(f.id) ?? tonightByTeams.get(`${f.home}|${f.away}`);
    const why = enOrNull(s?.why);
    const alarm = enOrNull(s?.alarm);
    if (!why || !alarm) return null;
    tonight.push({ id: f.id, alarm, why });
  }
  return { headline, summary, matches, tonight };
}
```

Then build the digest with per-language prose. Add an EN lookup map and a `bilingual` helper:

```js
  const narrationByMatch = new Map(narration.matches.map((m) => [m.id, m]));
  const narrationByFixture = new Map(narration.tonight.map((m) => [m.id, m]));
  const enByMatch = new Map((enNarration?.matches ?? []).map((m) => [m.id, m]));
  const enByFixture = new Map((enNarration?.tonight ?? []).map((m) => [m.id, m]));

  // Builds {ro, en} dropping the en key when the EN value is absent.
  const bilingual = (ro, en) => (en == null ? { ro } : { ro, en });
```

Replace the `digest` object's prose fields:

```js
  const digest = {
    date,
    factsHash: hash,
    narrator: bilingual(narratorRo, narratorEn),
    headline: bilingual(narration.headline, enNarration?.headline),
    summary: bilingual(narration.summary, enNarration?.summary),
    matches: facts.finished.map((m) => ({
      ...m,
      pill: bilingual(narrationByMatch.get(m.id)?.pill ?? '', enByMatch.get(m.id)?.pill),
      drama: narrationByMatch.get(m.id)?.drama ?? 1,
      highlight: mergeHighlight(m.id, recapByMatch, existingHighlightById),
    })),
    groups: standings.filter((g) => groupsThatPlayed.has(g.name)),
    tonight: facts.tonight.map((m) => ({
      id: m.id,
      home: m.home,
      away: m.away,
      homeCode: m.homeCode ?? null,
      awayCode: m.awayCode ?? null,
      kickoffEEST: m.kickoffEEST ?? kickoffEEST(m.utcDate),
      alarm: bilingual(narrationByFixture.get(m.id)?.alarm ?? 'citești dimineața', enByFixture.get(m.id)?.alarm),
      why: bilingual(narrationByFixture.get(m.id)?.why ?? '', enByFixture.get(m.id)?.why),
    })),
    teaser: bilingual(
      buildTeaser({ headline: narration.headline, matchCount: facts.finished.length, siteUrl }),
      enNarration ? buildTeaserEn({ headline: enNarration.headline, matchCount: facts.finished.length, siteUrl }) : undefined,
    ),
  };
```

- [ ] **Step 5: Pin OG / email outputs to the flat RO value**

All remaining `narration.headline`/`narration.summary` reads in `main` already point at the RO narration object (it stays flat), so OG image, `injectOgTags`, and `buildTeaser` are correct. Update the GitHub-Actions outputs and the `setOutput('narrator')` to use the flat RO string:

```js
  await setOutput('published', 'true');
  await setOutput('date', date);
  await setOutput('headline', narration.headline);   // flat RO string — correct
  await setOutput('match_count', String(digest.matches.length));
  await setOutput('narrator', narratorRo);            // flat RO string, not the {ro,en} object
  await setOutput('narrationChanged', String(!reused));
```

Add the `buildTeaserEn` import: in run.js, `import { buildTeaser, buildTeaserEn } from './teaser.js';`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test test/run.test.js test/prose-reuse.test.js`
Expected: PASS. (prose-reuse.test.js still green — `reuseNarration` is unchanged; `reuseNarrationEn` is new and covered in Task 8's run test. Add a focused `reuseNarrationEn` unit test to `test/prose-reuse.test.js` if not already — see Step 7.)

- [ ] **Step 7: Add focused `reuseNarrationEn` unit tests**

Add to `test/prose-reuse.test.js`:

```js
import { reuseNarrationEn } from '../pipeline/run.js';

const bilingualStored = {
  headline: { ro: 'RO h', en: 'EN h' },
  summary: { ro: 'RO s', en: 'EN s' },
  matches: [{ id: 1, home: 'Bosnia', away: 'Canada', pill: { ro: 'RO p', en: 'EN p' }, drama: 4 }],
  tonight: [{ id: 3, home: 'Brazilia', away: 'Maroc', alarm: { ro: 'merită văzut', en: 'stay up' }, why: { ro: 'RO w', en: 'EN w' } }],
};

test('reuseNarrationEn rebuilds the English side', () => {
  const en = reuseNarrationEn(bilingualStored, facts);
  assert.deepEqual(en, {
    headline: 'EN h', summary: 'EN s',
    matches: [{ id: 1, pill: 'EN p', drama: 4 }],
    tonight: [{ id: 3, alarm: 'stay up', why: 'EN w' }],
  });
});

test('reuseNarrationEn returns null for a RO-only stored day', () => {
  const roOnly = { headline: 'RO h', summary: 'RO s', matches: [{ id: 1, pill: 'p', drama: 1 }], tonight: [] };
  assert.equal(reuseNarrationEn(roOnly, { finished: [{ id: 1 }], tonight: [] }), null);
});
```

Run: `node --test test/prose-reuse.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add pipeline/run.js pipeline/teaser.js test/run.test.js test/prose-reuse.test.js
git commit -m "feat: assemble bilingual digest; pin OG/teaser/email to RO; reuse EN side"
```

---

### Task 9: EN offline fixture

**Files:**
- Create: `test/fixtures/narration.en.json`
- Test: covered by Task 7/8 offline runs.

**Interfaces:**
- Produces: the English stand-in for offline `--fixtures` runs, keyed to the same ids as `narration.json`.

- [ ] **Step 1: Create the fixture**

```json
{
  "headline": "Mexico survive a scare, Canada march on",
  "summary": "The hosts trembled until Lozano's 88th-minute penalty. Canada brushed Qatar aside 4-0 and pile on the goal-difference pressure.",
  "matches": [
    {
      "id": 760414,
      "pill": "Giménez headed Mexico in from inside the box, set up by Lozano, but South Africa drew level through an unfortunate own goal. Lozano settled it from the spot in the 88th. Mokoena's sending-off broke the visitors' momentum.",
      "drama": 4
    },
    {
      "id": 760415,
      "pill": "Canada were never troubled and pocketed three quiet points. Qatar already have it tough in Group B. Goal difference may yet matter at the end.",
      "drama": 1
    }
  ],
  "tonight": [
    {
      "id": 760416,
      "alarm": "stay up",
      "why": "Brazil's opener against a Morocco side that reached the semis last time - this one promises heat."
    },
    {
      "id": 760417,
      "alarm": "read in the morning",
      "why": "A small match at 1am - sleep wins this one."
    }
  ]
}
```

- [ ] **Step 2: Run the offline-dependent tests**

Run: `node --test test/narrator-select.test.js test/run.test.js`
Expected: PASS — the `getNarration (gemini single-pass) also produces EN` test and the bilingual run test now find the fixture.

- [ ] **Step 3: Commit**

```bash
git add test/fixtures/narration.en.json
git commit -m "test: English narration offline fixture"
```

---

### Task 10: Backfill migration script

**Files:**
- Create: `pipeline/backfill-en.js`
- Test: `test/backfill-en.test.js`

**Interfaces:**
- Consumes: Task 7 (`getEnNarration` via a shared entry — or call `narrateEn` / engine directly), Task 4 (`localizeProse`).
- Produces: `backfillDay(digest, enNarration)` → new digest with `en` merged into prose objects, RO untouched; idempotent (returns the digest unchanged when `headline.en` present). The CLI wrapper iterates `site/data/*.json`.

- [ ] **Step 1: Write the failing test**

```js
// test/backfill-en.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backfillDay, needsBackfill, reconstructFacts } from '../pipeline/backfill-en.js';

const legacyDigest = {
  date: '2026-06-12',
  narrator: 'gemini',
  headline: 'RO titlu',
  summary: 'RO sumar.',
  matches: [{ id: 1, home: 'A', away: 'B', score: [1, 0], scorers: [], events: [], stats: null, pill: 'RO pastilă', drama: 2 }],
  groups: [{ name: 'A', table: [] }],
  tonight: [{ id: 2, home: 'C', away: 'D', kickoffEEST: '21:00', alarm: 'merită văzut', why: 'RO de ce' }],
  teaser: '⚽ RO titlu · 1 meci azi-noapte, cu rezumate video\nhttps://x/',
};

const enNarration = {
  headline: 'EN headline',
  summary: 'EN summary.',
  matches: [{ id: 1, pill: 'EN pill', drama: 2 }],
  tonight: [{ id: 2, alarm: 'stay up', why: 'EN why' }],
};

test('needsBackfill: true for a flat-string day, false once headline.en exists', () => {
  assert.equal(needsBackfill(legacyDigest), true);
  assert.equal(needsBackfill(backfillDay(legacyDigest, enNarration)), false);
});

test('backfillDay merges EN and preserves RO verbatim', () => {
  const out = backfillDay(legacyDigest, enNarration);
  assert.deepEqual(out.headline, { ro: 'RO titlu', en: 'EN headline' });
  assert.deepEqual(out.matches[0].pill, { ro: 'RO pastilă', en: 'EN pill' });
  assert.deepEqual(out.tonight[0].alarm, { ro: 'merită văzut', en: 'stay up' });
  assert.deepEqual(out.narrator, { ro: 'gemini', en: 'gemini' });
  // RO untouched
  assert.equal(out.headline.ro, legacyDigest.headline);
  assert.equal(out.matches[0].score[0], 1);
});

test('reconstructFacts pulls the narration-facts shape from a stored day', () => {
  const facts = reconstructFacts(legacyDigest);
  assert.equal(facts.date, '2026-06-12');
  assert.equal(facts.finished[0].id, 1);
  assert.equal(facts.tonight[0].id, 2);
  // ranks are absent in stored days — reconstructed as null, not invented
  assert.equal(facts.tonight[0].homeRank ?? null, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/backfill-en.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the backfill module**

```js
// pipeline/backfill-en.js
/**
 * One-time migration: adds an English (`en`) side to every committed day's prose
 * fields, leaving the Romanian prose (and all facts) untouched. Idempotent — a
 * day that already has headline.en is skipped. EN tonight reasoning runs with
 * FIFA ranks absent (stored days never carried them); the EN prompt's null-rank
 * branch handles that, so historical EN tonight prose is slightly weaker than a
 * live run. Accepted: past "tonight" sections are ephemeral.
 *
 * Run AFTER the bilingual render.js/pipeline code is deployed (so the live site
 * tolerates the new shape), then deploy the data via a manual deploy.yml dispatch.
 *
 * Usage: node pipeline/backfill-en.js                 # all days in site/data
 *        node pipeline/backfill-en.js --date 2026-06-12
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { narrateEn } from './narrate.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA_DIR = path.join(ROOT, 'site', 'data');

/** A day needs backfill unless its headline is already a {ro,en} object with en. */
export function needsBackfill(digest) {
  return !(digest.headline && typeof digest.headline === 'object' && digest.headline.en != null);
}

/** {ro,en} from a (possibly already-object) RO field plus an EN string. */
function merge(field, en) {
  const ro = typeof field === 'object' && field !== null ? field.ro : field;
  return en == null ? { ro } : { ro, en };
}

/**
 * Reconstructs the narration-facts object from a stored day. Ranks are absent in
 * stored days, so they are reconstructed as null (the prompt must not invent a
 * hierarchy). Standings context is the classified `groups` (raw standings were
 * not stored).
 */
export function reconstructFacts(digest) {
  return {
    date: digest.date,
    finished: (digest.matches ?? []).map((m) => ({
      id: m.id, home: m.home, away: m.away, homeCode: m.homeCode, awayCode: m.awayCode,
      group: m.group, score: m.score, scorers: m.scorers ?? [], events: m.events ?? [],
      stats: m.stats ?? null, decidedOnPenalties: m.decidedOnPenalties ?? false,
    })),
    tonight: (digest.tonight ?? []).map((t) => ({
      id: t.id, home: t.home, away: t.away, homeCode: t.homeCode, awayCode: t.awayCode,
      kickoffEEST: t.kickoffEEST, homeRank: null, awayRank: null,
    })),
    standings: digest.groups ?? [],
  };
}

/** Merges an EN narration into a stored day's prose; RO and facts untouched. */
export function backfillDay(digest, enNarration) {
  const enMatch = new Map((enNarration.matches ?? []).map((m) => [m.id, m]));
  const enTonight = new Map((enNarration.tonight ?? []).map((t) => [t.id, t]));
  const matchCount = (digest.matches ?? []).length;

  return {
    ...digest,
    narrator: merge(digest.narrator, 'gemini'),
    headline: merge(digest.headline, enNarration.headline),
    summary: merge(digest.summary, enNarration.summary),
    matches: (digest.matches ?? []).map((m) => ({ ...m, pill: merge(m.pill, enMatch.get(m.id)?.pill) })),
    tonight: (digest.tonight ?? []).map((t) => ({
      ...t,
      alarm: merge(t.alarm, enTonight.get(t.id)?.alarm),
      why: merge(t.why, enTonight.get(t.id)?.why),
    })),
    teaser: merge(digest.teaser, buildTeaserEnFromHeadline(enNarration.headline, matchCount)),
  };
}

// Inline EN teaser (avoids importing the site teaser shape mismatch): the data
// file stores the full teaser string, so reuse the same format buildTeaserEn uses.
function buildTeaserEnFromHeadline(headline, matchCount) {
  const games = matchCount === 0 ? 'no matches overnight'
    : `${matchCount === 1 ? '1 match' : `${matchCount} matches`} overnight, with video highlights`;
  // siteUrl is part of the stored RO teaser; the EN teaser is rebuilt fresh on
  // future live runs, so a backfilled teaser.en URL is cosmetic. Use the canonical site URL.
  return `⚽ ${headline} · ${games}\nhttps://mcandea04.github.io/mondial/`;
}

async function main() {
  const dateArg = process.argv.includes('--date') ? process.argv[process.argv.indexOf('--date') + 1] : null;
  const files = (await readdir(DATA_DIR))
    .filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
    .filter((n) => !dateArg || n === `${dateArg}.json`);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  for (const file of files) {
    const full = path.join(DATA_DIR, file);
    const digest = JSON.parse(await readFile(full, 'utf8'));
    if (!needsBackfill(digest)) { console.log(`skip ${file} (already bilingual)`); continue; }
    const facts = reconstructFacts(digest);
    const enNarration = await narrateEn(facts, { apiKey });
    const merged = backfillDay(digest, enNarration);
    await writeFile(full, JSON.stringify(merged, null, 2));
    console.log(`backfilled ${file}`);
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/backfill-en.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add pipeline/backfill-en.js test/backfill-en.test.js
git commit -m "feat: one-time EN backfill migration (adds EN, preserves RO)"
```

---

### Task 11: Full suite + offline pipeline scenario

**Files:**
- No new files; verification only.

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: PASS — all files green, no warnings, no spurious logs (clean output per project rules).

- [ ] **Step 2: Run the offline pipeline end-to-end**

Run: `node pipeline/run.js --fixtures test/fixtures --date 2026-06-12 --out tmp/out`
Expected: exit 0, logs "Done: N matches…".

- [ ] **Step 3: Inspect the produced digest is bilingual and facts intact**

Run: `node -e "const d=require('./tmp/out/2026-06-12.json'); console.log(JSON.stringify({headline:d.headline, narrator:d.narrator, pill0:d.matches[0]?.pill, alarm0:d.tonight[0]?.alarm, teaser:d.teaser}, null, 2))"`
Expected: `headline`, `narrator`, `pill`, `alarm`, `teaser` all `{ro, en}`; scores and ids unchanged from the fixture.

- [ ] **Step 4: Verify EN-absent fallback path**

Temporarily move the EN fixture and re-run to confirm RO-only ships cleanly:

```bash
mv test/fixtures/narration.en.json /tmp/narration.en.json
node pipeline/run.js --fixtures test/fixtures --date 2026-06-12 --out tmp/out2
node -e "const d=require('./tmp/out2/2026-06-12.json'); console.log('headline:', JSON.stringify(d.headline)); console.log('en absent:', d.headline.en === undefined)"
mv /tmp/narration.en.json test/fixtures/narration.en.json
```

Expected: `headline` is `{ro: ...}` with no `en` key; run exits 0.

- [ ] **Step 5: No commit** (verification task; nothing changed).

---

### Task 12: Browser scenario (live visual proof)

**Files:**
- No new files; verification only. Uses the Playwright/browser MCP.

- [ ] **Step 1: Serve the site against the offline-built data**

Run: `node pipeline/run.js --fixtures test/fixtures --date 2026-06-12 --out site/data` is NOT used (would overwrite committed data). Instead serve a temp copy: build to `tmp/out`, copy `tmp/out/*` over a throwaway `tmp/site` that symlinks the assets, OR simplest — start a static server at the repo `site/` root after a normal local build. Use:

```bash
cd site && python3 -m http.server 8765 &
```

(If `site/data/latest.json` is already committed-bilingual after backfill, this shows real content; otherwise it shows the legacy RO-only day, which still must render correctly via `localize`.)

- [ ] **Step 2: Load the page and screenshot Romanian**

Navigate the browser to `http://localhost:8765/index.html`. Take a screenshot. Confirm: headline, pills, table headers (Echipă/MJ/GD/Pct/Status), tonight title "La noapte — merită alarma?" all Romanian.

- [ ] **Step 3: Click the EN toggle and screenshot English**

Click the `.lang-toggle` button. Take a screenshot. Confirm: UI labels switch (Team/P/GD/Pts/Status, "Tonight — worth the alarm?"), prose switches to English (if the day is bilingual) or stays Romanian (if legacy), and `<html lang>` is now `en`.

- [ ] **Step 4: Reload and confirm persistence**

Reload the page. Confirm the page comes up in English (localStorage persisted) with no flash of Romanian (the head bootstrap set `<html lang>` before paint).

- [ ] **Step 5: Repeat on the archive page**

Navigate to `arhiva.html`, pick a day, toggle language, confirm the shown day re-renders in the chosen language.

- [ ] **Step 6: Stop the server**

```bash
kill %1
```

- [ ] **Step 7: Save screenshots to artifacts**

Save the RO and EN screenshots under `.artifacts/main/screenshots/`.

- [ ] **Step 8: No commit** (verification task).

---

## Post-implementation: deploy ordering (run manually, NOT part of TDD)

These are operational steps for the user to run after the code is merged. **Do not run them as part of implementation.**

1. Merge the feature branch to `main` and let `digest.yml`/Pages deploy the new code (render.js tolerates legacy flat strings, so the live site stays correct).
2. With `GEMINI_API_KEY` in `.env`, run `node pipeline/backfill-en.js` locally; review the diff (RO prose must be unchanged).
3. Commit the backfilled `site/data/*.json` and deploy via a manual `deploy.yml` `workflow_dispatch` (no re-narration).
4. Verify the live site toggles languages on a backfilled day.

---

## Self-Review

**Spec coverage:**
- UI chrome translation → Tasks 1, 2 (UI_STRINGS, render threading). ✓
- Narration translation (native EN) → Tasks 4, 7. ✓
- Toggle + localStorage + default RO → Task 3. ✓
- Per-lang `{ro,en}` data shape, facts flat → Task 8. ✓
- EN engine = same as RO; EN failure → RO-only → Task 7. ✓
- Polish ladder EN prompts → Tasks 4, 5. ✓
- OG/teaser/email pinned to RO (no `[object Object]`) → Task 8 Step 5. ✓
- recentProse/gold localize → Task 8 Step 3. ✓
- reuse RO-required / EN-optional → Task 8 (`reuseNarrationEn`). ✓
- Backfill (adds EN, preserves RO, rank limitation) → Task 10. ✓
- Status badge static map → Task 1 (`STATUS_LABEL`), Task 2 (render). ✓
- alarm enum + `alarmIsWatch` (both langs + legacy) → Task 1, 2. ✓
- Deploy ordering (code-first) → post-impl section + Task 10 header comment. ✓
- EN offline fixture → Task 9. ✓
- narrator-select tests preserved → additive shape (design note) keeps them green. ✓
- Browser scenario proof → Task 12. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. Task 8 Step 1 references the existing `run.test.js` harness pattern — if absent, the step says to add an offline-run harness with the `--out` flag (concrete).

**Type consistency:** `localize`/`localizeProse` signatures match across tasks. `getNarration` returns `{narration, narrator, en}` (Task 7) consumed in Task 8. `bilingual(ro, en)` drops `en` when null — consistent with `localize`'s `field.en ?? field.ro` read. `reuseNarrationEn` exported from run.js and tested in Task 8 Step 7. `buildTeaserEn` (Task 6) used in Task 8; backfill uses an inline EN teaser (Task 10) to avoid a siteUrl-shape mismatch — noted.

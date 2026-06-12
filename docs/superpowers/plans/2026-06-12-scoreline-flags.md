# Country Flags on the Scoreline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each team's country flag on the match scoreline, in group standings tables, and in the tonight fixtures of the digest.

**Architecture:** Flags are derived as facts from the canonical English team name in `teams.js` (`flagCode()`), emitted by the `fetch.js` parse functions, and flow through `run.js` into the digest JSON. The vanilla site (`render.js`) renders bundled flag-icons 4:3 SVGs next to team names, degrading to nothing when a code is absent. Codes are outside the `factsHash` projection so published days never re-narrate.

**Tech Stack:** Node 20 ESM, `node --test`, vanilla DOM, flag-icons SVGs (vendored, not a runtime dep), Playwright for scenario proof.

---

## File Structure

- `pipeline/teams.js` — add `FLAG_CODES` map + `flagCode()` accessor (modify).
- `pipeline/fetch.js` — emit codes in `parseMatch`, `parseFixture`, `parseStandings` (modify).
- `pipeline/run.js` — forward `homeCode`/`awayCode` in the field-by-field `tonight` assembly (modify, ~line 281-289).
- `site/assets/flags/*.svg` — vendored flag-icons 4:3 SVGs (create).
- `site/assets/flags/SOURCE.md` — note the flag-icons version (create).
- `site/assets/render.js` — `flagImg()` helper + wire into scoreline/standings/tonight (modify).
- `site/assets/style.css` — `.flag`, `.flag-sm`, `.team` rules (modify).
- `test/teams.test.js` — `flagCode()` + map completeness + asset parity (create).
- `test/fetch.test.js` — assert code fields on parsed output (modify).

---

## Task 1: `flagCode()` and the `FLAG_CODES` map

**Files:**
- Modify: `pipeline/teams.js` (append after `romanianTeamName`, before the Spanish block)
- Test: `test/teams.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `test/teams.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagCode } from '../pipeline/teams.js';

test('flagCode returns ISO-2 for a sovereign country', () => {
  assert.equal(flagCode('Mexico'), 'mx');
  assert.equal(flagCode('South Korea'), 'kr');
});

test('flagCode returns flag-icons sub-national codes for home nations', () => {
  assert.equal(flagCode('England'), 'gb-eng');
  assert.equal(flagCode('Scotland'), 'gb-sct');
});

test('flagCode maps the easily-confused codes correctly', () => {
  assert.equal(flagCode('Congo DR'), 'cd');
  assert.equal(flagCode('Curaçao'), 'cw');
  assert.equal(flagCode('Cape Verde Islands'), 'cv');
  assert.equal(flagCode('Ivory Coast'), 'ci');
});

test('flagCode returns null for unknown names (knockout placeholders)', () => {
  assert.equal(flagCode('Winner Group A'), null);
  assert.equal(flagCode('1B'), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/teams.test.js`
Expected: FAIL — `flagCode` is not exported (SyntaxError / undefined).

- [ ] **Step 3: Add `FLAG_CODES` + `flagCode` to `pipeline/teams.js`**

Insert immediately after the `romanianTeamName` function (after line 56), before the `SPANISH_NAMES` comment block:

```javascript
/**
 * flag-icons codes keyed by the same canonical English names ROMANIAN_NAMES
 * uses. Lowercase ISO 3166-1 alpha-2, except the home nations which use
 * flag-icons sub-national codes (gb-eng, gb-sct). Unknown names (knockout
 * placeholders) return null so the renderer can skip the flag.
 */
const FLAG_CODES = {
  'Algeria': 'dz',
  'Argentina': 'ar',
  'Australia': 'au',
  'Austria': 'at',
  'Belgium': 'be',
  'Bosnia-Herzegovina': 'ba',
  'Brazil': 'br',
  'Canada': 'ca',
  'Cape Verde Islands': 'cv',
  'Colombia': 'co',
  'Congo DR': 'cd',
  'Croatia': 'hr',
  'Curaçao': 'cw',
  'Czechia': 'cz',
  'Ecuador': 'ec',
  'Egypt': 'eg',
  'England': 'gb-eng',
  'France': 'fr',
  'Germany': 'de',
  'Ghana': 'gh',
  'Haiti': 'ht',
  'Iran': 'ir',
  'Iraq': 'iq',
  'Ivory Coast': 'ci',
  'Japan': 'jp',
  'Jordan': 'jo',
  'Mexico': 'mx',
  'Morocco': 'ma',
  'Netherlands': 'nl',
  'New Zealand': 'nz',
  'Norway': 'no',
  'Panama': 'pa',
  'Paraguay': 'py',
  'Portugal': 'pt',
  'Qatar': 'qa',
  'Saudi Arabia': 'sa',
  'Scotland': 'gb-sct',
  'Senegal': 'sn',
  'South Africa': 'za',
  'South Korea': 'kr',
  'Spain': 'es',
  'Sweden': 'se',
  'Switzerland': 'ch',
  'Tunisia': 'tn',
  'Turkey': 'tr',
  'United States': 'us',
  'Uruguay': 'uy',
  'Uzbekistan': 'uz',
};

export function flagCode(name) {
  return FLAG_CODES[name] ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/teams.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add pipeline/teams.js test/teams.test.js
git commit -m "Add flagCode() mapping team names to flag-icons codes"
```

---

## Task 2: Map completeness test (both directions)

**Files:**
- Modify: `test/teams.test.js`
- Modify: `pipeline/teams.js` (export `ROMANIAN_NAMES` and `FLAG_CODES` keys for the test)

- [ ] **Step 1: Write the failing test**

The test needs the key sets of both maps. Add a named export of the keys rather than the whole maps (keep the maps private). Append to `test/teams.test.js`:

```javascript
import { teamNameKeys, flagCodeKeys } from '../pipeline/teams.js';

test('every ROMANIAN_NAMES key has a FLAG_CODES entry and vice versa', () => {
  const names = [...teamNameKeys()].sort();
  const codes = [...flagCodeKeys()].sort();
  assert.deepEqual(codes, names);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/teams.test.js`
Expected: FAIL — `teamNameKeys`/`flagCodeKeys` not exported.

- [ ] **Step 3: Export the key/value accessors from `pipeline/teams.js`**

Add right after the `flagCode` function. `flagCodeValues()` is exported here (not later) because Task 5's vendoring step depends on it:

```javascript
export function teamNameKeys() {
  return Object.keys(ROMANIAN_NAMES);
}

export function flagCodeKeys() {
  return Object.keys(FLAG_CODES);
}

export function flagCodeValues() {
  return Object.values(FLAG_CODES);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/teams.test.js`
Expected: PASS (5 tests). If it fails with a diff, a key is missing or misspelled in one map — fix the offending entry.

- [ ] **Step 5: Commit**

```bash
git add pipeline/teams.js test/teams.test.js
git commit -m "Enforce ROMANIAN_NAMES and FLAG_CODES key parity"
```

---

## Task 3: Emit codes from the `fetch.js` parse functions

**Files:**
- Modify: `pipeline/fetch.js` (`parseMatch` ~line 182, `parseFixture` ~line 199, `parseStandings` ~line 209)
- Modify: `test/fetch.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/fetch.test.js` (it already imports `parseMatch`, `parseStandings`; add `parseFixture` to the import and a `flagCode` import is not needed — assert literal codes):

Add `parseFixture` to the existing import block from `../pipeline/fetch.js`, then add:

```javascript
test('parseMatch attaches home/away flag codes from English names', () => {
  const match = {
    id: 1,
    homeTeam: { name: 'Mexico' },
    awayTeam: { name: 'South Africa' },
    score: { fullTime: { home: 2, away: 1 } },
    group: 'GROUP_A',
    utcDate: '2026-06-11T19:00:00Z',
  };
  const parsed = parseMatch(match);
  assert.equal(parsed.homeCode, 'mx');
  assert.equal(parsed.awayCode, 'za');
});

test('parseMatch leaves codes null for knockout placeholder names', () => {
  const match = {
    id: 2,
    homeTeam: { name: 'Winner Group A' },
    awayTeam: { name: 'Runner-up Group B' },
    score: { fullTime: { home: 0, away: 0 } },
    utcDate: '2026-07-01T19:00:00Z',
  };
  const parsed = parseMatch(match);
  assert.equal(parsed.homeCode, null);
  assert.equal(parsed.awayCode, null);
});

test('parseFixture attaches home/away flag codes', () => {
  const fixture = {
    id: 3,
    homeTeam: { name: 'Brazil' },
    awayTeam: { name: 'Morocco' },
    utcDate: '2026-06-12T19:00:00Z',
  };
  const parsed = parseFixture(fixture);
  assert.equal(parsed.homeCode, 'br');
  assert.equal(parsed.awayCode, 'ma');
});

test('parseStandings attaches a flag code per row from the English name', () => {
  const response = {
    standings: [
      {
        type: 'TOTAL',
        group: 'Group A',
        table: [
          { team: { name: 'Mexico' }, playedGames: 1, won: 1, draw: 0, lost: 0, goalDifference: 2, points: 3 },
          { team: { name: 'South Korea' }, playedGames: 1, won: 1, draw: 0, lost: 0, goalDifference: 1, points: 3 },
        ],
      },
    ],
  };
  const [group] = parseStandings(response);
  assert.equal(group.table[0].code, 'mx');
  assert.equal(group.table[1].code, 'kr');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/fetch.test.js`
Expected: FAIL — `homeCode`/`awayCode`/`code` are `undefined`, not the expected codes. (`parseFixture` import will succeed since it's already exported.)

- [ ] **Step 3: Add `flagCode` import and emit codes in the three parsers**

In `pipeline/fetch.js`, the import at the top currently is:

```javascript
import { romanianTeamName } from './teams.js';
```

Change to:

```javascript
import { romanianTeamName, flagCode } from './teams.js';
```

In `parseMatch`, the returned object — add two fields (keep keys grouped with `home`/`away`):

```javascript
  return {
    id: match.id,
    home: romanianTeamName(match.homeTeam.name),
    away: romanianTeamName(match.awayTeam.name),
    homeCode: flagCode(match.homeTeam.name),
    awayCode: flagCode(match.awayTeam.name),
    score: [match.score.fullTime.home, match.score.fullTime.away],
    scorers: goals,
    events,
    group: (match.group ?? '').replace('GROUP_', ''),
    utcDate: match.utcDate,
  };
```

In `parseFixture`, the returned object — add two fields after `away`:

```javascript
  return {
    id: match.id,
    home: romanianTeamName(match.homeTeam.name),
    away: romanianTeamName(match.awayTeam.name),
    homeCode: flagCode(match.homeTeam.name),
    awayCode: flagCode(match.awayTeam.name),
    group: (match.group ?? '').replace('GROUP_', ''),
    utcDate: match.utcDate,
    kickoffEEST: kickoffEEST(match.utcDate),
  };
```

In `parseStandings`, the row map — add `code` keyed off the English `row.team.name` (NOT the Romanianized `team`):

```javascript
      table: s.table.map((row) => ({
        team: romanianTeamName(row.team.name),
        code: flagCode(row.team.name),
        p: row.playedGames,
        w: row.won,
        d: row.draw,
        l: row.lost,
        gd: row.goalDifference,
        pts: row.points,
      })),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/fetch.test.js`
Expected: PASS (all fetch tests, including the 4 new ones).

- [ ] **Step 5: Commit**

```bash
git add pipeline/fetch.js test/fetch.test.js
git commit -m "Emit flag codes from match, fixture, and standings parsers"
```

---

## Task 4: Forward codes through `run.js` tonight assembly

**Files:**
- Modify: `pipeline/run.js` (~line 281-289, the `tonight: facts.tonight.map(...)` block)
- Test: covered by the existing `test/run.test.js` plus the scenario in Task 9

Matches already flow codes through `...m` and standings rows through `...row`. Only `tonight` is field-by-field and needs the explicit forward.

- [ ] **Step 1: Inspect the current tonight block**

Run: `grep -n "tonight: facts.tonight.map" pipeline/run.js`
The block reads:

```javascript
    tonight: facts.tonight.map((m) => ({
      id: m.id,
      home: m.home,
      away: m.away,
      kickoffEEST: m.kickoffEEST ?? kickoffEEST(m.utcDate),
      alarm: narrationByFixture.get(m.id)?.alarm ?? 'citești dimineața',
      why: narrationByFixture.get(m.id)?.why ?? '',
    })),
```

- [ ] **Step 2: Add the two code fields**

```javascript
    tonight: facts.tonight.map((m) => ({
      id: m.id,
      home: m.home,
      away: m.away,
      homeCode: m.homeCode ?? null,
      awayCode: m.awayCode ?? null,
      kickoffEEST: m.kickoffEEST ?? kickoffEEST(m.utcDate),
      alarm: narrationByFixture.get(m.id)?.alarm ?? 'citești dimineața',
      why: narrationByFixture.get(m.id)?.why ?? '',
    })),
```

- [ ] **Step 3: Run an offline pipeline run and inspect the output JSON**

Run:

```bash
node pipeline/run.js --fixtures test/fixtures --date 2026-06-12 --out /tmp/flags-out
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const d = JSON.parse(readFileSync('/tmp/flags-out/2026-06-12.json','utf8'));
console.log(JSON.stringify({
  m: d.matches.map(x => [x.home, x.homeCode, x.awayCode]),
  s: d.groups[0].table.map(r => [r.team, r.code]),
  t: d.tonight.map(x => [x.home, x.homeCode, x.awayCode]),
}, null, 2));
"
```

(This project is ESM — `require` is undefined in `node -e`, so the inspection uses `--input-type=module` + `readFileSync`.)

Expected: matches and standings rows show non-null codes (`mx`, `kr`, `cz`, `za` etc.); tonight fixtures (Brazil/Morocco, Qatar/New Zealand) show `br`/`ma`, `qa`/`nz`.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS — no regression (run.test.js, facts-hash.test.js especially, since the hash must be unchanged).

- [ ] **Step 5: Commit**

```bash
git add pipeline/run.js
git commit -m "Forward flag codes into tonight fixtures in the digest"
```

---

## Task 5: Vendor the flag SVGs

**Files:**
- Create: `site/assets/flags/<code>.svg` (~50 files)
- Create: `site/assets/flags/SOURCE.md`

- [ ] **Step 1: Install flag-icons as a dev dependency**

flag-icons is not installed (verified: not in `node_modules`, not in `package.json`). Install it dev-only — the SVGs get vendored, the package is not a runtime dep:

```bash
npm i -D flag-icons
```

Expected: `flag-icons` appears under `devDependencies` in `package.json`, version ~7.5.0.

- [ ] **Step 2: Copy exactly the codes in `FLAG_CODES` into `site/assets/flags/`**

The flags live at `node_modules/flag-icons/flags/4x3/<code>.svg`. Copy only the codes used, derived from `flagCodeValues()` (added in Task 6 — if running this task first, it can also be derived inline; the export is the clean source of truth). Run:

```bash
mkdir -p site/assets/flags
CODES=$(node --input-type=module -e "import('./pipeline/teams.js').then(m=>console.log(m.flagCodeValues().join(' ')))")
echo "Codes: $CODES"
for c in $CODES; do
  cp "node_modules/flag-icons/flags/4x3/$c.svg" "site/assets/flags/$c.svg" || echo "MISSING IN flag-icons: $c"
done
ls site/assets/flags/ | wc -l
```

Expected: 48 `.svg` files copied. `flagCodeValues()` was exported in Task 2, so this command works as-is. The loop reports any missing code (`cp` failure prints to stderr); the asset-parity test in Task 6 is the hard backstop.

- [ ] **Step 3: Verify filenames are exact lowercase**

Run: `ls site/assets/flags/ | grep -E '[A-Z]' && echo "UPPERCASE FOUND" || echo "all lowercase OK"`
Expected: `all lowercase OK` (case-sensitivity matters on the Linux Pages host).

- [ ] **Step 4: Record the source version**

Create `site/assets/flags/SOURCE.md`:

```markdown
# Flag assets

4:3 SVGs vendored from [flag-icons](https://github.com/lipis/flag-icons) (MIT).

- Version: 7.5.0
- Source path: `node_modules/flag-icons/flags/4x3/<code>.svg`
- Files here mirror the codes in `pipeline/teams.js` `FLAG_CODES`.
- Home nations use the sub-national codes `gb-eng`, `gb-sct`.

To refresh: `npm i -D flag-icons@latest`, then re-copy the codes in FLAG_CODES.
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json site/assets/flags/
git commit -m "Vendor flag-icons 4:3 SVGs for the 48 World Cup teams"
```

---

## Task 6: Asset-parity test

**Files:**
- Modify: `test/teams.test.js`

Catches a `FLAG_CODES` value with no on-disk SVG, or a casing mismatch, before deploy. `flagCodeValues()` was already exported in Task 2.

- [ ] **Step 1: Write the failing test**

Append to `test/teams.test.js`:

```javascript
import { flagCodeValues } from '../pipeline/teams.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FLAGS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'site', 'assets', 'flags');

test('every FLAG_CODES value has a byte-exact lowercase SVG on disk', () => {
  const missing = flagCodeValues().filter((code) => !existsSync(join(FLAGS_DIR, `${code}.svg`)));
  assert.deepEqual(missing, [], `missing flag SVGs: ${missing.join(', ')}`);
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `node --test test/teams.test.js`
Expected: PASS (6 tests) once Task 5 has vendored the SVGs. A failure here names the missing/miscased code — fix the asset in `site/assets/flags/`. (If Task 6 is run before Task 5, this test correctly FAILS listing all codes as missing — vendoring assets in Task 5 turns it green.)

- [ ] **Step 3: Commit**

```bash
git add pipeline/teams.js test/teams.test.js
git commit -m "Test that every flag code has a vendored SVG on disk"
```

---

## Task 7: `flagImg()` helper + CSS

**Files:**
- Modify: `site/assets/render.js` (add helper near `el()`, ~line 16-21)
- Modify: `site/assets/style.css`

`render.js` is browser DOM (untested by `node --test`); proof comes from the Task 9 scenario. This task only adds the helper and styles — no wiring yet.

- [ ] **Step 1: Add the `flagImg` helper to `render.js`**

Insert after the `el()` function (after line 21):

```javascript
function flagImg(code, sizeClass) {
  if (!code) return null;
  const img = el('img', sizeClass ? `flag ${sizeClass}` : 'flag');
  img.src = `assets/flags/${code}.svg`;
  img.alt = ''; // decorative; the team name beside it is the label
  img.setAttribute('aria-hidden', 'true');
  img.onerror = () => img.remove(); // a 404 leaves no broken-image box
  return img;
}
```

- [ ] **Step 2: Add a `--flag-outline` token to both `:root` blocks**

The file is token-driven: light vars in `:root` (~line 9-21), dark overrides inside the existing `@media (prefers-color-scheme: dark) { :root { ... } }` block (~line 23-38). Add the outline colour as a token in each so dark mode follows the file's convention rather than a bare selector override.

In the light `:root` (next to `--flame`), add:

```css
  --flag-outline: rgba(0, 0, 0, 0.12);
```

In the dark `:root` (inside the `@media` block, next to `--pill-head`), add:

```css
    --flag-outline: rgba(255, 255, 255, 0.18);
```

- [ ] **Step 3: Add the flag rules**

Insert after the `.score` rule (after line 96). `.team` is `inline-flex` (not `flex`): as a child of `.match-teams` it still lays out as a flex item, and in the tonight row it stays inline so the ` · time` span keeps sharing the line:

```css
.team { display: inline-flex; align-items: center; gap: 6px; min-width: 0; vertical-align: middle; }
.flag {
  height: 18px;
  width: auto;
  border-radius: 2px;
  outline: 0.5px solid var(--flag-outline);
  vertical-align: middle;
  flex-shrink: 0;
}
.flag-sm { height: 14px; }
/* keep standings team names at the table's 13px, not the scoreline's 15px */
td .team .team-name { font-size: 13px; font-weight: 400; }
```

- [ ] **Step 4: Sanity-check the files are readable**

Run: `node --input-type=module -e "import {readFileSync} from 'node:fs'; readFileSync('site/assets/render.js','utf8'); readFileSync('site/assets/style.css','utf8'); console.log('ok')"`
Expected: `ok` (this only confirms the files are readable; real proof is the scenario).

- [ ] **Step 5: Commit**

```bash
git add site/assets/render.js site/assets/style.css
git commit -m "Add flagImg helper and flag styles"
```

---

## Task 8: Wire flags into scoreline, standings, tonight

**Files:**
- Modify: `site/assets/render.js` (`renderMatchCard` ~line 44-60, `renderGroupCard` ~line 110-122, `renderTonight` ~line 130-145)

- [ ] **Step 1: Scoreline — wrap each side in a `.team` container**

In `renderMatchCard`, the current teams block is:

```javascript
  const teams = el('div', 'match-teams');
  teams.append(
    el('span', 'team-name', match.home),
    el('span', 'score', `${match.score[0]} – ${match.score[1]}`),
    el('span', 'team-name', match.away),
  );
```

Replace with home flag→name, score, away name→flag, each side wrapped so the flag hugs its name (filter null because `append(null)` throws):

```javascript
  const teams = el('div', 'match-teams');

  const homeSide = el('div', 'team');
  homeSide.append(...[flagImg(match.homeCode), el('span', 'team-name', match.home)].filter(Boolean));

  const score = el('span', 'score', `${match.score[0]} – ${match.score[1]}`);

  const awaySide = el('div', 'team');
  awaySide.append(...[el('span', 'team-name', match.away), flagImg(match.awayCode)].filter(Boolean));

  teams.append(homeSide, score, awaySide);
```

- [ ] **Step 2: Standings — flag inside the existing first cell**

In `renderGroupCard`, the row's first cell is currently:

```javascript
      el('td', null, row.team),
```

Replace that one argument with a cell holding a flex span of flag + name:

```javascript
      teamCell(row),
```

And add a `teamCell` helper just above `renderGroupCard` (after `renderMatchCard`):

```javascript
function teamCell(row) {
  const td = el('td', null);
  const wrap = el('span', 'team');
  wrap.append(...[flagImg(row.code, 'flag-sm'), el('span', 'team-name', row.team)].filter(Boolean));
  td.append(wrap);
  return td;
}
```

Note: the other cells in that `tr.append(...)` call stay as-is; only the first argument changes from `el('td', null, row.team)` to `teamCell(row)`.

- [ ] **Step 3: Tonight — bracket the combined match string**

In `renderTonight`, the left block currently appends:

```javascript
    left.append(
      el('span', 'tonight-match', `${fixture.home} – ${fixture.away}`),
      el('span', 'tonight-time', ` · ${fixture.kickoffEEST} EEST`),
    );
```

Wrap the match span between the two flags (filter null), keeping the time after:

```javascript
    const matchLine = el('span', 'team');
    matchLine.append(
      ...[
        flagImg(fixture.homeCode, 'flag-sm'),
        el('span', 'tonight-match', `${fixture.home} – ${fixture.away}`),
        flagImg(fixture.awayCode, 'flag-sm'),
      ].filter(Boolean),
    );
    left.append(matchLine, el('span', 'tonight-time', ` · ${fixture.kickoffEEST} EEST`));
```

- [ ] **Step 4: Sanity-check the file is readable**

Run: `node --input-type=module -e "import {readFileSync} from 'node:fs'; readFileSync('site/assets/render.js','utf8'); console.log('ok')"`
Expected: `ok`. Real proof is Task 9.

- [ ] **Step 5: Commit**

```bash
git add site/assets/render.js
git commit -m "Render team flags on scoreline, standings, and tonight"
```

---

## Task 9: Scenario proof (Playwright screenshots)

**Files:**
- No source changes, and **no changes to the real `site/data/`**. The committed
  `site/data/2026-06-12.json` is a real, curated published digest — never build
  the fixture run into `site/data`. Build into a throwaway copy of `site/`
  instead, so the working tree stays clean.

- [ ] **Step 1: Build a throwaway site copy with a fixture digest**

Copy the site to a temp dir and build the offline fixture digest into the copy's
`data/`. The real `site/data/` is never touched. The fixture run is fully
offline (`test/fixtures/narration.json` is present, so Gemini is not called):

```bash
rm -rf /tmp/flags-site && cp -R site /tmp/flags-site
node pipeline/run.js --fixtures test/fixtures --date 2026-06-12 --out /tmp/flags-site/data
ls /tmp/flags-site/data/latest.json /tmp/flags-site/assets/flags/mx.svg
```

Expected: `latest.json` (with code fields) and the vendored flags both exist in
the copy. Confirm the real tree is clean: `git status --short site/data` prints
nothing.

- [ ] **Step 2: Serve the throwaway copy locally**

```bash
(cd /tmp/flags-site && python3 -m http.server 8765 &)
sleep 1
```

- [ ] **Step 3: Screenshot with Playwright MCP**

Navigate the browser to `http://localhost:8765/index.html`, wait for
`.match-teams` to render, and take a full-page screenshot to
`.artifacts/main/screenshots/flags-index.png`. Then navigate to
`http://localhost:8765/arhiva.html`, pick the 2026-06-12 date, and screenshot
the standings + tonight. Close the browser when done.

Verify in the screenshots:
- Host flag left of the home name, visitor flag right of the away name, flag
  hugging its name (not floating mid-gap).
- Standings: a small flag left of each team name, columns still aligned, long
  names ("Africa de Sud", "Coreea de Sud") not truncated, name text the same
  13px size as before (not enlarged).
- Tonight: small flags bracketing each `home – away` line, and the ` · time`
  text still on the SAME line as the match (the `.team` wrapper is `inline-flex`).
- No broken-image boxes anywhere.

- [ ] **Step 4: Screenshot dark mode**

Re-take the index screenshot with the browser emulating dark color scheme
(Playwright device emulation / `Emulation.setEmulatedMedia`), save to
`.artifacts/main/screenshots/flags-index-dark.png`. Confirm the flags show the
lighter `--flag-outline` and stay visible against the dark card (Japan `jp` has
a large white field — a good check).

- [ ] **Step 5: Stop the server and remove the throwaway copy**

```bash
kill %1 2>/dev/null || true
rm -rf /tmp/flags-site
git status --short site/data
```

Expected: `git status --short site/data` prints nothing — the real archive was
never modified.

- [ ] **Step 6: Run the full suite once more**

Run: `npm test`
Expected: PASS — all unit + parity tests green.

---

## Task 10: Code-simplifier pass

**Files:**
- All changed files: `pipeline/teams.js`, `pipeline/fetch.js`, `pipeline/run.js`, `site/assets/render.js`, `site/assets/style.css`, `test/teams.test.js`, `test/fetch.test.js`

- [ ] **Step 1: Run the code-simplifier subagent over the diff**

Dispatch the `code-simplifier` subagent on the changed files. It must preserve all behavior — no test deletions, no flag removed.

- [ ] **Step 2: Re-run tests and the scenario**

Run: `npm test` → PASS. Re-run Task 9 steps 1-5 if render.js or teams.js changed, confirming flags still render.

- [ ] **Step 3: Commit any simplifications**

Stage explicit paths (not `git add -A`) so no stray artifact or throwaway file is committed:

```bash
git add pipeline/teams.js pipeline/fetch.js pipeline/run.js site/assets/render.js site/assets/style.css test/teams.test.js test/fetch.test.js
git commit -m "Simplify flag rendering after review"
```

---

## Self-review notes

- **Spec coverage:** teams.js map + accessor (T1), parity both directions (T2), pipeline emit (T3), run.js tonight forward (T4), vendored assets + version note + lowercase (T5), asset-parity test (T6), flagImg with onerror + no lazy + CSS 18px/`.flag-sm`/dark outline (T7), scoreline `.team` wrapper + standings same-cell + tonight bracket (T8), Playwright scenario incl. dark mode + degrade (T9), simplifier (T10). factsHash guardrail honored — codes never enter `project()` (untouched). Archive backfill: not done by design.
- **Type/name consistency:** `flagCode`, `flagCodeKeys`, `flagCodeValues`, `teamNameKeys`, `flagImg(code, sizeClass)`, `teamCell(row)`, `.team`, `.flag`, `.flag-sm`, field names `homeCode`/`awayCode`/`code` — used identically across tasks.
- **No placeholders:** every code step shows full code.

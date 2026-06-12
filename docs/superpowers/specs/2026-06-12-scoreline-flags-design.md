# Country flags on the scoreline — design

## Goal

Show each team's country flag in the digest: on the match scoreline (host flag
on the left, visitor flag on the right), in the group standings tables, and in
the "La noapte" tonight fixtures. Decorative — the Romanian team name stays the
authoritative label next to it.

## Core principle compliance

Flags are derived from the canonical English team name (a fact already parsed
in `fetch.js`), not from narration. The model never originates a flag. This
keeps with "code establishes facts, the model writes the drama".

The flag fields are NOT part of the `factsHash` projection (`facts-hash.js`
`project()` keeps only `date`, finished `{id, score}`, tonight
`{id, home, away, kickoffEEST}`). So adding codes does not unfreeze published
days and does not trigger re-narration. **Guardrail: never add code fields to
`project()`** — doing so would invalidate every frozen day's hash.

## Source of truth — `teams.js`

Add a flag-code map keyed off the same canonical English names that
`ROMANIAN_NAMES` uses, plus an accessor:

```
const FLAG_CODES = {
  'Mexico': 'mx',
  'South Korea': 'kr',
  'England': 'gb-eng',
  'Scotland': 'gb-sct',
  // ... one entry per team in ROMANIAN_NAMES
};

export function flagCode(name) {
  return FLAG_CODES[name] ?? null;
}
```

- Codes are lowercase ISO 3166-1 alpha-2 for sovereign countries.
- Home nations use the flag-icons sub-national codes: `gb-eng` (England, St
  George's cross), `gb-sct` (Scotland, the saltire). No team in the 48 needs
  the Union Jack, Wales, or Northern Ireland.
- Unknown names (knockout placeholders like "Winner Group A") return `null`.

Non-obvious codes the implementer must get exactly right — wrong values 404 or
show the wrong country with no test to catch it. The map key is the **exact**
`ROMANIAN_NAMES` key string (note the diacritics/wording):

| `ROMANIAN_NAMES` key | code |
|---|---|
| `England` | `gb-eng` |
| `Scotland` | `gb-sct` |
| `South Korea` | `kr` |
| `Cape Verde Islands` | `cv` |
| `Congo DR` | `cd` (DR Congo — NOT `cg`) |
| `Curaçao` | `cw` (key has the ç cedilla) |
| `Ivory Coast` | `ci` |
| `Czechia` | `cz` |
| `Switzerland` | `ch` |
| `South Africa` | `za` |
| `Saudi Arabia` | `sa` |
| `Bosnia-Herzegovina` | `ba` |
| `United States` | `us` |
| `Turkey` | `tr` |
| `Uzbekistan` | `uz` |
| `Jordan` | `jo` |
| `Iraq` | `iq` |
| `Qatar` | `qa` |
| `Panama` | `pa` |

The remaining teams take the obvious alpha-2 code.

Every key present in `ROMANIAN_NAMES` must have a `FLAG_CODES` entry, and
`FLAG_CODES` must contain no extra keys (bidirectional equality). A unit test
enforces both directions so a future team addition can't silently ship flagless
and a typo'd extra key can't slip in.

## Pipeline — emit codes as facts

`fetch.js` parse functions already hold the English name. Key the lookup off
the **English** name (`match.homeTeam.name`, `row.team.name`), never the
already-Romanianized `home`/`team` field — keying off the Romanian form yields
all-null:

- `parseMatch(match)` → `homeCode: flagCode(match.homeTeam.name)`,
  `awayCode: flagCode(match.awayTeam.name)`
- `parseFixture(match)` → `homeCode`, `awayCode` (same)
- `parseStandings(response)` → each table row gets
  `code: flagCode(row.team.name)`

`run.js` needs almost no change:
- `matches` are built with `...m`, so `homeCode`/`awayCode` flow through.
- standings rows are copied wholesale by `classifyGroup` (`...row` in
  `standings.js:22`, verified), so `code` flows through.
- `tonight` is assembled field-by-field — add `homeCode: m.homeCode` and
  `awayCode: m.awayCode` explicitly (the code must already be set on `m` by
  `parseFixture`).

No JSON schema version bump; the fields are additive and optional on read.

## Flag assets

Source: the `flag-icons` npm package (MIT licence), rectangular 4:3 SVGs at
`node_modules/flag-icons/flags/4x3/<code>.svg`. Acquisition step (one-time,
the SVGs are vendored, the package is NOT a runtime dependency):

```
npm i -D flag-icons
mkdir -p site/assets/flags
# copy only the codes that appear in FLAG_CODES (≈48 countries + gb-eng + gb-sct)
cp node_modules/flag-icons/flags/4x3/<code>.svg site/assets/flags/
```

Commit the copied SVGs to the repo: no build step, works offline, no runtime
network call. Record the flag-icons version in a comment/note in the flags dir.

**Filenames must be exact lowercase** (`gb-eng.svg`, not `GB-ENG.svg`). macOS
dev is case-insensitive and will hide a casing mistake; GitHub Pages / Linux CI
is case-sensitive and 404s. A test asserts every `FLAG_CODES` value maps to a
byte-exact on-disk file (see Testing).

## Render — `site/assets/render.js`

Add a helper. No `loading="lazy"` (flags are above the fold, lazy adds nothing
and can flash). An `onerror` removes a broken `<img>` so a missing/404 asset
leaves no broken-image box:

```
function flagImg(code, sizeClass) {
  if (!code) return null;
  const img = el('img', sizeClass ? `flag ${sizeClass}` : 'flag');
  img.src = `assets/flags/${code}.svg`;
  img.alt = '';                          // decorative; name sits beside it
  img.setAttribute('aria-hidden', 'true');
  img.onerror = () => img.remove();      // 404 → no broken-image box
  return img;
}
```

`Node.append(null)` THROWS (it does not skip like React). Every insertion site
must build a children array, filter null, then spread — never
`append(flagImg(x), ...)` directly:

```
teams.append(...[homeFlag, nameEl, scoreEl, awayName, awayFlag].filter(Boolean));
```

Wire it in:

- **Scoreline** (`renderMatchCard`): wrap `flag + team-name` in a per-side
  sub-container (`.team` div) so the flag hugs its name. `.match-teams` has a
  uniform `gap: 12px`; inserting bare flag siblings would float each flag 12px
  off its name and read as center-anchored. Structure:
  `[.team: homeFlag + homeName] [score] [.team: awayName + awayFlag]`.
  Within the away `.team`, name comes first then flag (mirror), so flags sit at
  the outer edges of the scoreline.
- **Standings** (`renderGroupCard`): flag before the team name **inside the
  existing first `<td>`** (no new column), wrapped with the name in an inline
  flex span so the column boundary stays put. Use the `.flag-sm` modifier. The
  team column is `table-layout: fixed; width: 32%` and already holds long names
  ("Bosnia și Herțegovina", "Coasta de Fildeș") — verify names don't truncate;
  widen `col-team` a few % if the flag squeezes them.
- **Tonight** (`renderTonight`): `${fixture.home} – ${fixture.away}` is a single
  combined `.tonight-match` span. Bracket the whole string — one flag before,
  one after (`[homeFlag] "Mexic – Anglia" [awayFlag]`). Do NOT split the span
  into per-team nodes. Use `.flag-sm`.

`flagImg` returning `null` (no element created) is the graceful-degrade path
for knockout placeholders and the un-backfilled archive. This is distinct from
a present `<img>` whose file 404s — that case is handled by the `onerror`
remove above.

### Accessibility

Flags are `alt=""` + `aria-hidden="true"`: purely decorative, the team name in
the adjacent element/text is the accessible label, so the flag must not be
announced. In standings the name text in the same cell remains the cell's
content. Run the accessibility-checker skill over the rendered output to confirm
no contrast or labeling regressions.

## Archive

No backfill. The committed `site/data/*.json` predate this change and have no
codes; `flagImg(undefined)` returns `null`, so those cards render flagless.
Only days built after this change carry flags. Caveat: a frozen day that is
manually **re-run** (`node run.js --date <old>`) rebuilds its full digest from
current facts and will then acquire codes + rewrite its JSON — the freeze reuses
*prose*, not the stored fact fields. Days that are never re-run stay flagless.

## CSS — `site/assets/style.css`

- `.flag`: `height: 18px` (explicit px — do NOT use `1em`; `1em` resolves
  against the img's inherited 16px, not the 24px `.score`, and an implementer
  expecting it to track the score would get 24px and break vertical centering),
  `width: auto` (preserves 4:3), `border-radius: 2px`, a subtle `outline`/
  `box-shadow` so a white-edged flag (Japan) reads against the card surface
  (`#ffffff` light / `#272725` dark — pick an outline colour that works in
  both), `vertical-align: middle`, small horizontal margin.
- `.flag-sm` modifier (~14px) for standings and tonight rows so flags don't
  crowd the tables.
- Add a `.team` wrapper rule for the scoreline (flex, `align-items: center`,
  small gap) — verify the score stays vertically centered and the row stays
  balanced when one side's flag is null (knockout placeholder).

## Out of scope

- OG share image (satori). satori only reads `score`/`home`/`away`/`highlight`
  from match objects and ignores the new code fields, so the extra fields are
  inert there — no breakage, but no flags in the share PNG either. Adding flags
  to satori needs embedded image bytes, not a CSS `<img>`: separate, larger
  effort. Not in this change.
- Teaser/share text: `buildTeaser` reads only headline/counts, unaffected.
- Backfilling old archive JSONs.

## Testing

Unit (`node --test`):
- `flagCode()`: known country → ISO-2, home nation → `gb-*`, unknown → `null`.
- Completeness (both directions): every `ROMANIAN_NAMES` key has a `FLAG_CODES`
  entry AND `FLAG_CODES` has no extra keys.
- Asset parity: every `FLAG_CODES` value has a byte-exact lowercase file at
  `site/assets/flags/<code>.svg` (catches casing + missing-asset before deploy).
- `parseMatch` / `parseFixture` / `parseStandings` over `test/fixtures` now
  carry the code fields with expected values. Confirm the fixtures use real
  team names (not placeholders) so the codes are non-null and prove rendering.

Scenario (the real proof):
- Offline run: `node pipeline/run.js --fixtures test/fixtures --date 2026-06-12 --out <tmp>`,
  then load the generated digest in the site and Playwright-screenshot the
  scoreline, a standings table, and the tonight card. Confirm flags appear on
  the correct side, hug their team name, degrade cleanly where a code is absent,
  and that dark mode renders the white-flag outline.

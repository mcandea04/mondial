# FIFA highlights integration — design

## Problem

The per-match "▶ Rezumat" links came from the El Gráfico YouTube channel via
`pipeline/highlights.js`. Those videos have been taken down, so the source is
dead and every new digest would ship without highlights.

FIFA publishes official match highlights on `fifa.com` with no login and no
paywall (verified: `fifa.com/en/watch/<id>`). They are reachable through a JSON
API that the FIFA+ site itself calls. This replaces El Gráfico as the highlight
source. Because the links are plain hyperlinks to FIFA's own public watch pages,
there is no publishing-rights concern of the kind that kept the El Gráfico path
disabled.

## Goal

For the finished matches in the digest currently being built (`facts.finished`
for the run's date), attach the official FIFA highlight URL to each match it can
be keyed to. No archive backfill, no touching past day JSONs.

## Non-goals

- Backfilling highlights into older archive digests.
- Purging dead El Gráfico URLs already committed in past day JSONs (separate
  cleanup, out of scope here).
- Embedding video. The "highlight" field stays a URL string; `render.js` keeps
  drawing the existing "▶ Rezumat" link.
- Re-polling for late-published highlights. The digest is built once and frozen;
  a match whose FIFA reel is not yet published at build time simply gets no
  highlight (see "Publish latency" below).
- Any change that lets highlight data originate a fact (score, scorer,
  qualification). A highlight URL is a fact fetched by code and keyed by match
  `id`, never produced by the narration model — same contract as before.

## Source API (verified 2026-06-13, group stage)

All endpoints return plain JSON, no auth, no key.

**Listing** — one call returns the recent played-match highlights, fully keyed:

    GET https://cxm-api.fifa.com/fifaplusweb/api/sections/news/<SECTION_ID>?locale=en&limit=50

`limit=50` is baked into the `LISTING_URL` constant (a night's finished matches
sit near the head of the feed; 50 covers them with margin after filtering).

`<SECTION_ID>` is the highlights section id (`1klF18lgpe12FFtd1IoTSs` at time of
writing). Response shape:

    {
      "items": [
        {
          "entryId": "7wv3jFr0T2wczSuQbhgrSW",
          "title": "Mexico v South Africa | Group A | FIFA World Cup 2026™ | Highlights",
          "semanticTags": [
            { "sourceCategory": "Match",   "title": "Mexico ... South Africa on 06/11/2026 19:00 UTC", "id": "400021443" },
            { "sourceCategory": "Country", "title": "Mexico",       "id": "MEX" },
            { "sourceCategory": "Country", "title": "South Africa", "id": "RSA" }
          ]
        }
      ]
    }

The watch URL is built from `entryId`: `https://www.fifa.com/en/watch/<entryId>`.
Each item carries everything needed to key it — no per-video detail fetch:
kickoff UTC (parsed from the `sourceCategory: "Match"` tag title) and the
`sourceCategory: "Country"` tags (FIFA tricodes).

### Source quirks (each handled below, not assumed away)

- **Noise variants.** The feed mixes in "Alt Cast Highlights: ..." (FIFA Rivals
  reimaginings) and "... | Play Zone". Only canonical match reels are kept (see
  Canonical filter).
- **FIFA team names ≠ football-data names** (`Korea Republic` vs `South Korea`,
  `USA` vs `United States`, `Turkiye` vs `Turkey`, `Bosnia and Herzegovina` vs
  `Bosnia-Herzegovina`). Names are never used for keying — kickoff UTC and
  country codes are.
- **FIFA country codes are FIFA tricodes, not ISO-3166** (`RSA` not `ZAF`, `GER`
  not `DEU`, `NED`, `POR`, `SUI`, `URU`, `CRO`, ...). The bridge below maps FIFA
  tricodes directly to our flag codes — it is not an ISO-3 table.
- **One-sided Country tags.** Some items carry only one `Country` tag. The
  collision guard needs only one matching side, so this is fine.
- **Verified on the group stage only.** SECTION_ID and feed completeness for the
  knockout phase are unverified; see Risks.

## Keying

Match facts already carry `utcDate` (ISO from football-data) and `homeCode` /
`awayCode` (our flag codes via `teams.js`). See `pipeline/fetch.js:193,200`.

### Canonical filter

Keep an item only if its `title` ends with the exact suffix

    | FIFA World Cup 2026™ | Highlights

(`title.endsWith(CANONICAL_SUFFIX)`, where the suffix includes the `™` glyph).
This drops "Alt Cast Highlights: … | FIFA World Cup 2026" (ends in `2026`, no
`| Highlights`) and "… | Play Zone" (ends in `Play Zone`). The suffix is the
single rule — there is no separate "not Alt Cast" clause. Other unforeseen
variants (Extended/Condensed/sponsor suffixes) fall outside the suffix and are
dropped; that is the safe direction (no highlight beats a wrong one).

### Timestamp parsing (no `Date.parse` on the FIFA string)

The FIFA Match-tag title ends with `… on MM/DD/YYYY HH:mm UTC`. Parse it with an
explicit regex into UTC epoch ms via `Date.UTC(yyyy, mm-1, dd, HH, MM)` — never
`Date.parse`, whose handling of `MM/DD/YYYY … UTC` is engine- and locale-
dependent and would mis-key under a non-US host locale or CI timezone. If the
regex does not match, the item has no usable kickoff and is skipped.

### Match resolution

1. **Primary key — kickoff minute.** Compare the parsed FIFA kickoff to
   `Date.parse(match.utcDate)` truncated to the **whole minute** (floor both to
   60_000 ms). FIFA carries minute precision; football-data may carry seconds,
   so equality is at minute granularity, not raw ms. This avoids dropping a
   match over a `:00` vs `:30` seconds difference.
2. **Collision guard — country code.** Final group matchdays kick off two
   matches at the same UTC minute by design. When more than one finished match
   shares the kickoff minute, confirm by country: convert the item's FIFA
   tricodes to our flag codes and require at least one to equal the match's
   `homeCode` or `awayCode`. (Knockout matches are staggered, so kickoff minute
   alone keys them; the guard only ever engages on simultaneous group games,
   where both teams are real and coded.)
3. **Drop, never guess.** After the guard, a video that resolves to zero matches,
   or still to more than one, is dropped. If a match's two flag codes are both
   `null` (knockout placeholder not yet resolved by football-data) and its
   kickoff collides, it cannot be confirmed and is left without a highlight —
   never attached to a guess.

### At most one highlight per match

Iterate items in `json.items[]` array order; the **first** canonical item that
resolves to a given match id wins. A later duplicate or re-upload for the same
match is ignored (deterministic, not last-write-wins). "First" means array index,
no re-sorting. The order only matters when two items key to the same match
(re-upload), which is what test 8 exercises; the result is stable for a given
response.

### Tricode bridge

Add a `FIFA_TRICODE_TO_FLAG` map to `teams.js` (alongside the existing name/flag
maps — "add new mappings here, not inline", per project convention) covering the
48 finalists. It maps **FIFA tricodes** to our existing flag codes, including the
sub-national home nations:

    RSA → za, GER → de, NED → nl, POR → pt, SUI → ch, URU → uy, CRO → hr,
    ENG → gb-eng, SCO → gb-sct, USA → us, KOR → kr, ...

An unknown tricode maps to `null`, which just means that side can't be used to
confirm a collision. The map is a **hardcoded literal** in `teams.js` (like the
existing name/flag maps — not generated or fetched at runtime); the implementer
hand-authors the 48 rows from the confirmed finalists while building it.

## Module structure

Keep `pipeline/highlights.js` as the module and keep the two functions that
external code uses, so the digest assembly, teaser, and render are unaffected:

- `fetchRecaps({ matches, fetchImpl = fetch })` → `Promise<Map<matchId, url>>`.
  The default `fetchImpl` is the global `fetch`; `run.js` calls it with no
  `fetchImpl` (`run.js:164`), so the default must survive the rewrite. The retry
  loop wraps `fetchImpl` (the injected one), so test 9 can drive retries through
  an injected impl.
- `recapsFor(matches, entries)` → `Map<matchId, url>` (pure; used by tests and
  the offline-fixtures path). `entries` is the parsed array from
  `parseHighlightFeed`.

The `run.js` local wrapper keeps its name `getRecaps`, and all downstream recap
vocabulary (`recapByMatch`, `recapCount`, the manifest `recaps` map) is left
unchanged. Only the El-Gráfico-era internals are renamed; the integration
surface keeps its current names so downstream stays untouched.

Internal functions change (the YouTube-era `parseRecapFeed` and `matchRecap` are
removed, not kept as aliases):

- `parseHighlightFeed(json)` → `[{ url, kickoffMs, codes }]` where `codes` is an
  unordered array of our flag codes (length 1 or 2; the keying only ever asks
  "does any code match home or away", so home/away order is irrelevant).
  `parseHighlightFeed` does the FIFA-tricode → flag-code conversion itself (it
  imports the bridge from `teams.js`), so its output is already in our codes.
  It applies the canonical filter and per-item validation; malformed items are
  skipped.
- `recapsFor(matches, entries)` takes the **parsed** array from
  `parseHighlightFeed` (i.e. `[{ url, kickoffMs, codes }]`), not raw JSON, and
  does the kickoff+code resolution below. Both the live path (`fetchRecaps` →
  `parseHighlightFeed` → `recapsFor`) and the offline fixtures path funnel
  through `recapsFor`, so keying is identical online and offline.
- The kickoff+code resolution above replaces title+score matching.

Document `LISTING_URL` and `SECTION_ID` as named constants at the top of the
module (plain constants, the way `RECAP_FEED_URL` is today — not env-overridable;
drift is handled by soft-fail, not configuration).

### run.js changes (small but real — it is not untouched)

`run.js` currently (`run.js:150-165`):
- gates the whole path behind `HIGHLIGHTS_ENABLED !== '1'`,
- in the fixtures branch reads `recaps.xml` and calls `parseRecapFeed`,
- imports `parseRecapFeed`, `recapsFor` (and `fetchRecaps`) from the module.

Changes:
- **Remove the `HIGHLIGHTS_ENABLED` gate** and its stale "unresolved publishing
  rights" comment. FIFA watch links are public; the feature is on by default,
  with soft-fail as the only safety valve.
- Fixtures branch reads `highlights.json`, calls `parseHighlightFeed`, and pipes
  its output through `recapsFor` (same as the live path).
- Update the import to drop `parseRecapFeed` and add `parseHighlightFeed`.

**Also remove the gate from `.env.example`** (`.env.example:15`
`HIGHLIGHTS_ENABLED=` plus its "unresolved rights" comment). The knob is gone, so
the example must not document it.

Everything downstream is unchanged: the `highlight` field on each match stays a
URL string or `null` (`run.js:279`), `teaser.js` recap-count, the manifest recap
count, and the `render.js` "▶ Rezumat" link all keep working as-is.

## Publish latency (accepted, best-effort)

`--require-complete` builds the digest the moment the last match of the night is
FINISHED on football-data. FIFA cuts its highlight reel after full-time, with a
lag. So the freshest late game may have no reel in the feed yet at build time.
This is accepted: that match ships with `null` and no "▶ Rezumat". Highlights are
optional; the digest never waits for them and never re-polls. (If this proves
annoying in practice, a future change could add a short grace re-poll — explicitly
out of scope here.)

## Error handling

- **Transient failures retry.** A transient failure is a 429, a 5xx, **or a
  thrown network error** (the `fetchImpl` rejects — ECONNRESET, DNS, timeout).
  Retry a small bounded number of times (2-3 attempts) with a **short** backoff
  (order of 1-3s, not narrate.js's 20/60/120s — highlights are optional and the
  run is cron-timed, so it must not spend minutes retrying). This is the same
  *idea* as narrate.js's transient retry, but deliberately shorter.
- **Permanent failures soft-fail.** After retries are exhausted, or on a 404 or a
  body that parses but has no usable `items` shape, log a warn and return an
  empty `Map`. A body that fails `JSON.parse` is treated as transient (it gets
  the bounded retry) and then, if still failing, soft-fails like the rest. The
  digest proceeds with no highlights; it never fails on a highlight problem.
- **Expected noise vs malformed are different.** Non-canonical items (Alt Cast,
  Play Zone — anything failing the canonical suffix) are *expected noise* and are
  dropped **silently**, no warn. They are not errors.
- **Per-item validation, not all-or-nothing.** Within a successfully parsed
  feed, a canonical item that is nonetheless malformed (missing/empty `entryId`,
  or a canonical title whose Match-tag timestamp won't parse) is skipped
  individually; the remaining good items are still keyed. A single bad item never
  blanks the night. (Whether a single malformed-canonical item warrants a warn is
  fine either way, but it must not be noisy enough to dirty test output.)
- **No `undefined` URLs.** An item with a missing/empty `entryId` is skipped
  before any URL is formed, so `fifa.com/en/watch/undefined` can never be
  produced. This preserves the "never a wrong link" property.
- **SECTION_ID drift** degrades to "no highlights" (recap count 0) via the
  permanent-failure path — visible in the teaser, never a broken build or a
  wrong link.

## Offline / fixtures

`getRecaps` reads a canned feed under `--fixtures` instead of calling FIFA. The
migration must be done in lockstep so nothing imports a deleted file:

- Delete `test/fixtures/recaps.xml`; add `test/fixtures/highlights.json` holding
  the real FIFA listing shape (authored from a captured live sample so it carries
  the actual quirks: FIFA tricodes like `RSA`, the `™` suffix, at least one
  one-sided-Country item, and one "Alt Cast" noise item to prove filtering),
  covering the fixture matches.
- The fixtures branch of `getRecaps` reads `highlights.json` and calls
  `parseHighlightFeed`; if the file is absent it returns an empty Map (same
  tolerant behavior as today's missing-file case).

Offline run stays fully offline: `node pipeline/run.js --fixtures test/fixtures
--date 2026-06-12` attaches highlights from the canned file with no network.

## Testing

Two existing test files must change in lockstep with the source/fixtures, or
`npm test` (the only gate before the nightly cron publishes) breaks:

- **`test/highlights.test.js`** — rewrite wholesale. It currently imports the
  removed `parseRecapFeed`/`matchRecap` and loads `recaps.xml` at top level; both
  go away in the same change, or the file throws at import.
- **`test/run.test.js`** — migrate (`test/run.test.js:117-146`). It defines
  `HIGHLIGHTS_ON = { HIGHLIGHTS_ENABLED: '1' }`, writes/reads `recaps.xml`, and
  asserts `manifest.recaps[DATE] === 2` plus a "disabled by default → all
  `highlight === null`" test. With the gate removed and the feature on by
  default, drop the `HIGHLIGHTS_ON` env override, switch the fixtures to
  `highlights.json`, delete the "disabled by default" test (the premise no longer
  exists), and keep the manifest recap-count assertions pointed at the new
  fixture. This file is a hard build-breaker if left as-is.

All new `highlights.test.js` cases run offline against the canned
`highlights.json` and an injected `fetchImpl`:

1. `parseHighlightFeed` keeps canonical `… | FIFA World Cup 2026™ | Highlights`
   items and drops `Alt Cast` and `Play Zone`.
2. `parseHighlightFeed` extracts `entryId` → watch URL, kickoff ms (via the
   explicit regex, asserted in UTC regardless of host TZ), and our flag codes
   from FIFA tricodes.
3. `recapsFor` keys a video to the right match by kickoff minute.
4. Seconds tolerance: a football-data `utcDate` with non-zero seconds still keys
   to the FIFA minute-precision kickoff.
5. Simultaneous-kickoff collision: two finished matches at the same UTC minute
   are disambiguated by flag code; the correct match gets the URL, the other does
   not.
6. A video whose kickoff matches no finished match is dropped.
7. A video that stays ambiguous after the code guard is dropped (not guessed),
   including the both-codes-null knockout-placeholder case.
8. At-most-one-per-match: two canonical items resolving to the same match → the
   first in feed order wins, deterministically.
9. `fetchRecaps` retries a 429/5xx then succeeds (injected `fetchImpl`); retries
   a thrown network error then succeeds; and returns an empty Map after exhausting
   retries on a permanent 404, without throwing.
10. Per-item validation: a feed with one malformed item (empty `entryId`) and
    one good item yields exactly one keyed URL and no `…/watch/undefined`.
11. Tricode → flag-code conversion: known tricodes map (incl. `ENG`→`gb-eng`,
    `SCO`→`gb-sct`); unknown tricode → `null` and that side is simply unconfirmed.

Test output must stay clean — no spurious warns from the soft-fail/retry paths
leaking into passing-test output (suppress or assert on them).

The live network check is **not** a `node --test` case (it would flake CI). It
lives under `scripts/` (not `test/`) so `node --test test/` never runs it:
`node scripts/check-fifa-highlights.js` fetches the real FIFA feed and prints the
keyed `matchId → url` map for the most recent night, exiting non-zero only on a
thrown error (not on an empty map). It needs no `FOOTBALL_DATA_TOKEN` if it keys
against a small hardcoded recent-night match list embedded in the script; keep it
self-contained. It is a **manual** scenario and does **not** gate merge — the
offline scenarios (1 and 3) are sufficient for "done" in a hands-off run.

## Verification (scenarios, run before declaring done)

1. Offline fixtures run (`--fixtures test/fixtures`) attaches the expected
   highlight URLs to the fixture matches and to no others; teaser recap count
   reflects them.
2. Live one-off (standalone script, network): for a known recent night,
   `fetchRecaps({ matches })` against the real FIFA endpoint returns the correct
   watch URLs keyed to the right match ids.
3. Render check: a built digest JSON with highlights shows the "▶ Rezumat" link
   pointing at `fifa.com/en/watch/<id>` for the keyed matches, and no link for
   matches with no published reel.

## Risks

- **SECTION_ID drift / per-stage sections** — the id is verified only on the
  group stage. If the knockout phase uses a different section, that phase returns
  no highlights. Mitigated by soft-fail (no break, no wrong link); detectable as
  a sustained recap count of 0 once knockouts begin. Re-verify the section id at
  the knockout transition.
- **Publish latency** — accepted as best-effort (see above); the latest game may
  ship without a reel.
- **Feed depth** — scope is only the current digest's finished matches, which sit
  near the head of the feed; a generous `limit` (e.g. 50) covers a night's games.
  Not a concern at group stage; revisit only if a future night's matches fall
  outside the window after filtering.

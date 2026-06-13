# FIFA highlights integration — design

## Problem

The per-match "▶ Rezumat" links came from the El Gráfico YouTube channel via
`pipeline/highlights.js`. Those videos have been taken down, so the source is
dead and every new digest would ship without highlights.

FIFA publishes official match highlights on `fifa.com` with no login and no
paywall (verified: `fifa.com/en/watch/<id>`). They are reachable through a JSON
API that the FIFA+ site itself calls. This replaces El Gráfico as the highlight
source.

## Goal

For the matches in the digest currently being built (`facts.finished` for the
run's date), attach the official FIFA highlight URL to each match it can be
keyed to. No archive backfill, no touching past day JSONs.

## Non-goals

- Backfilling highlights into older archive digests.
- Purging dead El Gráfico URLs already committed in past day JSONs (separate
  cleanup, out of scope here).
- Embedding video. The "highlight" field stays a URL string; `render.js` keeps
  drawing the existing "▶ Rezumat" link.
- Any change that lets highlight data originate a fact (score, scorer,
  qualification). A highlight URL is a fact fetched by code and keyed by match
  `id`, never produced by the narration model — same contract as before.

## Source API (verified 2026-06-13)

All endpoints return plain JSON, no auth, no key.

**Listing** — one call returns every recent played-match highlight, fully keyed:

    GET https://cxm-api.fifa.com/fifaplusweb/api/sections/news/<SECTION_ID>?locale=en&limit=<N>

`<SECTION_ID>` is the highlights section id (`1klF18lgpe12FFtd1IoTSs` at time of
writing). Response shape:

    {
      "items": [
        {
          "entryId": "7wv3jFr0T2wczSuQbhgrSW",
          "title": "Mexico v South Africa | Group A | FIFA World Cup 2026™ | Highlights",
          "internalTitle": "Video > FWC 2026 > Mexico v South Africa | ... | Highlights",
          "semanticTags": [
            { "sourceCategory": "Match", "title": "Mexico ... South Africa on 06/11/2026 19:00 UTC", "id": "400021443" },
            { "sourceCategory": "Country", "title": "Mexico", "id": "MEX" },
            { "sourceCategory": "Country", "title": "South Africa", "id": "RSA" }
          ]
        }
      ]
    }

The watch URL is built from `entryId`: `https://www.fifa.com/en/watch/<entryId>`.

Each item carries everything needed to key it — no per-video detail fetch:
- kickoff UTC, parsed from the `sourceCategory: "Match"` tag title
  (`MM/DD/YYYY HH:mm UTC`);
- the two `sourceCategory: "Country"` tags give ISO-3 tricodes (`MEX`, `RSA`).

### Source quirks

- The feed mixes in non-canonical variants: "Alt Cast Highlights: ..." (FIFA
  Rivals reimaginings) and "... | Play Zone". Keep only canonical entries whose
  title ends with `| Highlights` and is not prefixed `Alt Cast`.
- FIFA's English team names differ from football-data's (`Korea Republic` vs
  `South Korea`, `USA` vs `United States`, `Turkiye` vs `Turkey`,
  `Bosnia and Herzegovina` vs `Bosnia-Herzegovina`). **Names are not used for
  keying** — kickoff UTC and country tricodes are. Country codes are stable;
  nicknames are not.
- The `Country` tags observed sometimes include only one side; design must work
  when only the home country is present (still enough to break a tie).

## Keying

Match facts already carry `utcDate` (ISO from football-data) and `homeCode` /
`awayCode` (ISO-2 flag codes via `teams.js`). See `pipeline/fetch.js:193,200`.

1. **Primary key — kickoff UTC.** Parse the FIFA Match-tag timestamp to an epoch
   ms and compare to `Date.parse(match.utcDate)`. Exact equality.
2. **Collision guard — flag code.** Final-round group matchdays kick off
   simultaneously (two games, same UTC). When more than one finished match
   shares the kickoff, confirm by matching at least one team: convert the FIFA
   ISO-3 tricodes to ISO-2 and require one to equal `match.homeCode` or
   `match.awayCode`.
3. A FIFA video that resolves to zero or more-than-one match after the guard is
   **dropped**, never attached to a guessed match.

### Tricode bridge

FIFA uses ISO-3 (`RSA`, `CAN`, `MEX`); our flag codes are ISO-2 (`za`, `ca`,
`mx`). Add a small ISO-3 → ISO-2 map covering the 48 World Cup participants to
`teams.js` (alongside the existing name/flag maps — "add new mappings here, not
inline", per project convention). Unknown tricode → `null`, which simply means
the collision guard can't confirm that side.

## Module structure

Keep `pipeline/highlights.js` as the module and keep its public surface so
`run.js`, `teaser.js`, and `render.js` stay untouched:

- `fetchRecaps({ matches, fetchImpl })` → `Promise<Map<matchId, url>>`,
  never throws (non-200 / network / parse / schema all yield an empty map so a
  FIFA outage cannot break the digest — same contract as today).
- `recapsFor(matches, entries)` → `Map<matchId, url>` (pure, used by tests and
  by the offline-fixtures path).

Internal functions change:
- `parseRecapFeed(xml)` (YouTube Atom) is replaced by
  `parseHighlightFeed(json)` → `[{ url, kickoffMs, codes: [iso2...] }]`,
  filtering out non-canonical variants.
- `matchRecap` / title+score matching is replaced by the kickoff+code keying
  above.

`run.js` keeps calling `getRecaps(facts.finished, { fixtures })` exactly as now
(`run.js:265`). The `highlight` field on each match stays a URL string or
`null`. `teaser.js` recap-count and `render.js` "▶ Rezumat" link are unchanged.

Document the live URL shape and `SECTION_ID` as named constants at the top of
the module, the way `RECAP_FEED_URL` is documented today.

## Offline / fixtures

`getRecaps` reads a canned feed under `--fixtures` instead of calling FIFA
(`run.js:157`). Replace the canned `recaps.xml` with a canned
`highlights.json` holding the FIFA listing shape (a few items covering the
fixture matches plus one Alt-Cast noise item to prove filtering). Update
`test/fixtures/` and the fixtures branch of `getRecaps` to read `.json`.

Offline run stays fully offline: `node pipeline/run.js --fixtures test/fixtures
--date 2026-06-12` must attach highlights from the canned file with no network.

## Error handling

- Non-200, network error, JSON parse failure, or unexpected shape → log a warn
  and return an empty `Map`. The digest proceeds with no highlights; it never
  fails on a highlight problem.
- `SECTION_ID` is a CMS entry id, not a documented stable endpoint. It has been
  stable across loads but FIFA could re-key it. Mitigation: the soft-fail above
  means a re-key degrades to "no highlights", visibly (warn log + recap count
  drops to 0 in the teaser), never a broken build or a wrong link.

## Testing

`node --test test/highlights.test.js`, all offline against the canned
`highlights.json`. Cases:

1. `parseHighlightFeed` keeps canonical `| Highlights` items, drops `Alt Cast`
   and `Play Zone`.
2. `parseHighlightFeed` extracts `entryId` → watch URL, kickoff ms, and ISO-2
   codes from tricodes.
3. `recapsFor` keys a video to the right match by kickoff UTC.
4. Simultaneous-kickoff collision: two finished matches at the same UTC are
   disambiguated by flag code; the correct match gets the URL, the other does
   not.
5. A video whose kickoff matches no finished match is dropped.
6. A video that stays ambiguous after the code guard is dropped (not guessed).
7. `fetchRecaps` returns an empty Map on a non-200 and on malformed JSON
   (injected `fetchImpl`), without throwing.
8. Tricode → ISO-2 conversion: known tricode maps; unknown tricode → `null`
   and the side is simply unconfirmed.

Test output must stay clean — no spurious warns leaking from the soft-fail
paths into passing-test output (suppress or assert on them).

## Verification (scenarios, run before declaring done)

1. Offline fixtures run attaches the expected highlight URLs to the fixture
   matches and to no others; teaser recap count reflects them.
2. A live `fetchRecaps({ matches })` against the real FIFA endpoint, for a known
   recent night, returns the correct watch URLs keyed to the right match ids
   (manual one-off, network required).
3. Render check: a built digest JSON with highlights shows the "▶ Rezumat"
   link pointing at `fifa.com/en/watch/<id>` for the keyed matches.

## Risks

- **`SECTION_ID` drift** — mitigated by soft-fail; detectable via recap count.
- **Feed depth at scale** — currently returns all played matches, but scope is
  only the current digest's finished matches (top of the feed), so depth at 104
  matches is not a concern for this feature.
- **One-sided Country tags** — handled: collision guard needs only one side.

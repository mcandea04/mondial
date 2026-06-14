# Richer match facts for narration

**Date:** 2026-06-14
**Status:** Approved for planning

## Problem

The Gemini/Opus narrator writes from a thin fact set: per goal it gets only
scorer name, minute, and side; per booking only red/yellow + minute + name; per
match only the final score and the group table. It has no material to say *how* a
goal was scored, who set it up, why a card was shown, or that a team dominated and
still lost. The prose stays generic because the facts are generic.

ESPN's `summary?event=<id>` payload — which `pipeline/enrich.js` **already fetches
once per finished match** — carries far more than we read. This change extracts
three richer signals from that same response (no new network calls) and feeds them
to the model as structured facts, so the prose can be specific without the model
ever inventing or originating a fact.

## Core principle (unchanged, load-bearing)

**Code establishes facts, the model writes the drama.** Every new field is a fact
computed in `pipeline/` and merged verbatim. The model only recasts facts into
Romanian voice. Specifically:

- The model must **never** receive raw English prose it could copy. Goal manner is
  parsed into typed tokens (already Romanian where the vocabulary is fixed), not
  passed as an English sentence.
- Any field the model omits falls back to a default; any field the parser can't
  produce is simply absent. Enrichment is best-effort and never blocks a night.

## Scope

In scope (chosen by the user):

1. **Goal manner + assist** — per goal: penalty/own-goal flag (from ESPN's typed
   field), body part, shot distance/location, and assister name.
2. **Team match stats** — per team: possession %, total shots, shots on target,
   corners, saves, fouls.
3. **Card reasons** — per booking: a short reason ("for a bad foul", "dissent")
   when ESPN provides one, including for yellow cards.

Out of scope (explicitly dropped):

- Substitutions (low drama value, mostly noise).
- Any change to `site/assets/render.js` — the new fields ride into
  `site/data/<date>.json` and become available to the site, but rendering them is a
  separate, later piece of work.
- ESPN `commentary` and `leaders` arrays (not selected; revisit later if wanted).

## Data sources (verified live against ESPN on 2026-06-13 matches)

### Goal `keyEvent`

A scoring `keyEvent` carries:

    {
      "type": { "text": "Goal" | "Penalty - Scored" | "Own Goal" },
      "scoringPlay": true,
      "clock": { "displayValue": "21'" },
      "team": { "id": "2869" },
      "participants": [ { "athlete": { "displayName": "Ismael Saibari" } },
                        { "athlete": { "displayName": "Brahim Díaz" } } ],
      "text": "Goal! Brazil 0, Morocco 1. Ismael Saibari (Morocco) right footed
               shot from outside the box to the centre of the goal. Assisted by
               Brahim Díaz with a through ball following a fast break."
    }

- **Penalty / own-goal**: read from `type.text` (`"Penalty - Scored"`,
  `"Own Goal"`) — a structured field, **not** the English sentence. For an own
  goal, `participants[0]` is the scoring-into-own-net player and ESPN already
  attributes the goal to the benefiting team via the score in `text`; we keep the
  existing side handling and only flag `ownGoal: true`.
- **Assist**: `participants[1].athlete.displayName` — but **only for plain
  `type.text === "Goal"`**. Verified live 2026-06-13 (`type` → `participants`):
  - `"Goal"` → `[scorer, assister]` (nParts 2) or `[scorer]` (nParts 1, no assist).
  - `"Penalty - Scored"` → `[taker]` (nParts **1**, never an assist slot).
  - `"Own Goal"` → `[own-goaler, **opponent**]` (nParts 2) — `participants[1]` is
    the OTHER team's player, **not** an assister. Reading it as an assist would
    attribute a false fact. So assist is taken **only** when
    `type.text === "Goal"`; penalty and own-goal yield `assist: null`. A name is a
    proper noun — safe to pass verbatim (we already pass scorer names verbatim).
- **Body part / distance**: parsed from `text` into fixed Romanian tokens (see
  parser below). These are closed vocabularies, never free text.

### Card `keyEvent`

    "text": "Casemiro (Brazil) is shown the yellow card for a bad foul."
    "text": "Mahmoud Abunada (Qatar) is shown the yellow card."   // no reason

Reason is the clause after `the yellow|red card` — `"for a bad foul"`, or absent.

### Boxscore team stats

`summary.boxscore.teams[]` — two entries, each with `team` and a `statistics[]`
array of `{ name, displayValue }`. Verified names we consume:

    possessionPct, totalShots, shotsOnTarget, wonCorners, saves, foulsCommitted

`boxscore.players` is empty for this competition — ignored.

## Components

All new logic is pure functions added to existing modules, each unit-testable on
the real strings/objects sampled above.

### 1. `pipeline/enrich.js` — goal manner parser

New pure function:

    parseGoalManner(text) -> { bodyPart?, placement? }

- `bodyPart`: maps `"right footed"` → `"dreptul"`, `"left footed"` → `"stângul"`,
  `"header"` / `"with the head"` → `"cu capul"`. Absent if no match.
- `placement`: maps `"from outside the box"` → `"din afara careului"`,
  `"from the centre of the box"` → `"din careu"`, `"from the left side of the box"`
  → `"din stânga careului"`, `"from the right side of the box"` →
  `"din dreapta careului"`, `"from a free kick"`/`"direct free kick"` →
  `"din lovitură liberă"`. Absent if no recognized phrase.
- Unknown phrasing → both keys **absent from the returned object** (not `null`).
  Never throws. The mapping table is the single source of truth and lives at the
  top of the module. The table is the canonical, exhaustive set as of this spec; a
  new ESPN phrase is a code change (add a row), never dynamic discovery.

> **Null vs absent — one rule for the whole feature.** `parseGoalManner` returns
> only the keys it found, so a goal object may or may not carry `bodyPart`/
> `placement`. To give the model a uniform shape, **`parseMatch` normalizes every
> new field to an explicit value** (string or `null`) when it builds the fact
> object — see component 4. So the model never sees a missing key, only `null` for
> "unknown". Its rule is "use a token only when it is a non-null string."

> Decision: we map to Romanian tokens at parse time (not at prompt time) so the
> fact handed to the model is already in the target language and the model's only
> job is to weave it into a sentence. This keeps the English text out of the model
> entirely.

### 2. `pipeline/enrich.js` — `eventsToFootballData` extension

Extend the existing loop so each shaped goal/booking carries the new fields:

    goals.push({
      minute, scorer: { name }, team,
      penalty: type === 'Penalty - Scored',
      ownGoal: type === 'Own Goal',
      // Only a plain "Goal" has an assist in participants[1]; on an own goal that
      // slot is the OPPONENT (verified live), and a penalty has no second slot.
      assist: type === 'Goal' ? (participants[1]?.athlete?.displayName ?? null) : null,
      ...parseGoalManner(event.text ?? ''),   // bodyPart, placement
    });

The exact-string match on `type.text` is deliberate: an unrecognized type (a
future ESPN variant) falls through to `penalty:false, ownGoal:false`, which is the
safe default — the goal is narrated as open-play, never mis-flagged. `bodyPart`/
`placement` then come from `parseGoalManner` regardless of type.

    bookings.push({
      minute, card, player: { name }, team,
      reason: parseCardReason(event.text ?? ''),   // null when absent
    });

`parseCardReason(text)` is a second small pure function. It extracts the clause
after `the yellow|red card` and maps it through a small closed English→Romanian
table (decision: option **(b)**, see "Resolved decisions" below) — no English ever
reaches the model. Table:

    "for a bad foul"           → "pentru un fault dur"
    "for a professional foul"  → "pentru fault tactic"
    "for dissent"              → "pentru proteste"
    "for unsporting behaviour" → "pentru atitudine nesportivă"
    "for a rough tackle"       → "pentru o intrare dură"

A reason not in the table, or a bare "… yellow card." with no reason, yields
`null`. Numeric coercion is not involved. The table lives beside the mapping
tables at the top of `enrich.js`.

### 3. `pipeline/enrich.js` — team stats extractor

New pure function:

    teamStats(summary, homeAwayById) -> { home: {...}, away: {...} } | null

Reads `summary.boxscore.teams[]`, resolves each to home/away via the same id map
already built by `homeAwayMap`, and projects the six chosen stats. Returns `null`
when boxscore is missing or malformed (best-effort).

`enrichFinishedMatches` attaches the result as `match.matchStats` (a new field on
the football-data-shaped object, alongside `goals`/`bookings`).

Stat values: ESPN gives `displayValue` as a string. `teamStats` keeps the six
values **as-is from `displayValue`** (e.g. `"51.4"`, `"12"`) without `Number()`
coercion — this sidesteps the `"–"`/`"N/A"`-becomes-`NaN` trap entirely. A stat
whose `displayValue` is missing is omitted from that team's object; `teamStats`
returns `null` only when the whole boxscore is absent. The model reads these as
labelled values, never does arithmetic on them, so strings are fine. JSON keys are
the **raw ESPN names** (`possessionPct`, `totalShots`, `shotsOnTarget`,
`wonCorners`, `saves`, `foulsCommitted`) — no renaming.

### 4. `pipeline/fetch.js` — `parseMatch` passthrough

`parseMatch` extends its `scorers` / `events` mapping and adds a `stats` field:

    scorers: goals.map(g => ({
      name, minute, team,
      penalty: g.penalty ?? false,
      ownGoal: g.ownGoal ?? false,
      assist: g.assist ?? null,
      bodyPart: g.bodyPart ?? null,     // normalize absent → null (uniform shape)
      placement: g.placement ?? null,
    }))

    events: bookings.filter(RED|YELLOW_RED).map(b => ({
      name, minute, team, reason: b.reason ?? null,
    }))

    stats: match.matchStats ?? null      // { home, away } or null

This `?? null` defaulting is what gives the model a uniform shape regardless of
what the parsers found, and also makes a match that came from football-data with no
ESPN enrichment at all (offline, or an ESPN outage) produce
`penalty:false, ownGoal:false, assist:null, bodyPart:null, placement:null` and
`stats:null` — never a missing key, never a crash.

> Note: `events` still filters to red / second-yellow only, matching today's
> behaviour (the digest shows dismissals, not every yellow). Card **reasons** thus
> attach to reds. If we later want yellow-card colour we widen the filter — out of
> scope here.

### 5. `pipeline/narration-core.js` — prompt rules

Both engines share `SYSTEM_PROMPT` (`claude-engine.js` only appends a JSON-format
instruction on top), so this single edit reaches Gemini and Opus alike.

Add a block to `SYSTEM_PROMPT` after the `VOCEA` section. Exact Romanian text to
add (kept short to not dilute the existing voice/exclamation constraints):

    DETALIILE MECIULUI (folosește-le, nu le inventa):
    - Pentru fiecare gol primești, când există: cum a fost marcat (bodyPart: „cu
      capul"/„cu dreptul"/„cu stângul"), de unde (placement: „din afara careului"
      etc.), dacă a fost din penalty sau autogol, și cine a pasat (assist).
      Țese-le natural în frază: „a marcat cu capul din careu", „din penalty",
      „autogol", „la pasa lui X". Folosește un detaliu DOAR dacă e prezent (non-null);
      ce lipsește, taci despre el — nu deduce și nu inventa.
    - „stats" sunt cifrele meciului per echipă (posesie, șuturi, șuturi pe poartă,
      cornere, intervenții portar, faulturi). Le folosești ca poveste, nu ca tabel:
      o echipă cu posesie/șuturi mari care a pierdut sau a remizat e o poveste („a
      tras de N ori și n-a marcat"). Nu înșirui cifre seci; alegi una care spune
      ceva. Dacă scorul e 0-0 și cifrele nu spun nimic, NU forța un unghi statistic.
    - Aceste detalii sunt FAPTE primite, nu text de copiat. Nu scrii niciun cuvânt
      în engleză.

No schema change — the model's *output* shape (`headline`, `summary`, per-match
`pill`/`drama`, `tonight`) is unchanged. The new fields are **input only**. The
addition is ~8 lines; it adds no new exclamation and no portal-speak, so the
existing "max one exclamation / no portal-speak" constraints still hold. The
scenario step verifies exclamation count and absence of English on a real run.

### 6. `pipeline/facts-hash.js` — projection extension (important)

`factsHash` currently projects finished matches to `{ id, score }` only. The
freeze/re-narrate gate keys off this hash. Two distinct concerns, kept separate:

1. **The persisted JSON never loses the new fields.** `run.js` always rebuilds
   `digest.matches` from the fresh `facts.finished` objects, and the reuse path only
   supplies prose (`pill`/`drama`/`headline`/…). So even when prose is reused, an
   enriched `scorers`/`events`/`stats` is re-written every run.

2. **Re-narrate on new *discrete* facts, not on stat drift.** The projection covers
   the discrete drama facts only:

       { id, score, scorers, events }   // stats deliberately EXCLUDED

   A late assist or a dismissal reason re-narrates once. **`stats` are excluded** —
   possession/shots are revised repeatedly post-whistle and are flavor, not drama;
   hashing them would churn the narrator (and risk an Opus→Gemini engine swap) for no
   narrative gain. Stats still ride into the published JSON.

   `canonicalize` sorts object keys only, **not** array elements — so `project()`
   sorts `scorers`/`events` itself with a `byEvent` total order (minute numeric,
   then name, team, assist/reason) so the order ESPN returns goals in never flips
   the hash.

3. **Monotonic enrichment guard (`mergeEnrichment` in run.js).** A finished match
   ESPN once enriched is never downgraded by a later poll whose `/summary` failed
   (empty scorers + events + null stats). When the fresh parse has no detail but the
   stored digest carried it, the stored detail is restored — *before* hashing, so a
   transient ESPN outage can't flip the hash, re-narrate empty, and deploy a degraded
   digest over a good one. Mirrors `mergeHighlight`. The score itself comes from
   football-data and is always fresh, so it is left untouched. This also keeps a
   `--steer`'d morning stable across later automated polls.

## Data flow

    enrich.js (ESPN summary, already fetched)
      ├─ parseGoalManner / type.text / participants[1] ─→ goals[] += manner/assist
      ├─ parseCardReason ─────────────────────────────→ bookings[] += reason
      └─ teamStats(summary) ──────────────────────────→ match.matchStats
        │
        ▼  parseMatch (fetch.js)
      finished match fact { scorers[+manner/assist], events[+reason], stats }
        │
        ├─→ factsForNarration ─→ factsHash (now covers new fields)
        │                     └─→ buildUserMessage ─→ model (input only)
        └─→ site/data/<date>.json  (available to render.js later; not rendered now)

## Error handling

- Every parser is best-effort and pure: unknown input → field absent / `null`,
  never an exception.
- `teamStats` returns `null` on missing/garbled boxscore; `parseMatch` stores
  `stats: null`; the model treats absent stats as "no stats angle".
- `enrichFinishedMatches` keeps its existing try/catch per match: any failure
  leaves the match exactly as football-data returned it (empty richer fields), and
  the night still publishes. No new failure mode blocks a digest.
- The model omitting any new signal is normal — pills already default to `''` and
  drama to `1`.

## Testing

`node --test` over `test/`. New/extended unit tests, all on the real ESPN strings
captured in this spec (no mocking of the function under test):

- `enrich.test.js`:
  - `parseGoalManner` on each sampled goal text (footed/header/outside-box/
    centre/left-side, and an unknown string → `{}`).
  - `parseCardReason` maps "… for a bad foul" → "pentru un fault dur", returns
    `null` for the bare "… yellow card." and for an off-table reason.
  - `eventsToFootballData` produces `penalty`/`ownGoal`/`assist`/`bodyPart`/
    `placement` on the Brazil–Morocco and Qatar–Switzerland samples (penalty,
    own-goal, two open-play goals with assists).
  - `teamStats` projects the six stats with correct home/away resolution; returns
    `null` on absent boxscore.
- `fetch.test.js`: `parseMatch` passes the new fields through and defaults them
  when goals/bookings lack them; `stats` is `null` when `matchStats` absent.
- `facts-hash.test.js`: changing a scorer's `assist` (or `stats`) changes the hash;
  reordering scorers does not.
- Offline fixtures: `--fixtures` **bypasses `enrich.js` entirely** (run.js:137-149
  reads `matches.json` and goes straight to `parseMatch`). So the new fields are
  exercised offline by **hand-baking them into the football-data-shaped goals in
  `test/fixtures/matches.json`**: add `assist`/`penalty`/`ownGoal` and (matching
  `parseGoalManner`'s output) `bodyPart`/`placement` to the goal objects, `reason`
  to bookings, and a `matchStats` block on the finished match. This validates the
  `parseMatch` passthrough + the prompt end-to-end without the network. The
  `enrich.js` parsers themselves are covered by `enrich.test.js` on the real ESPN
  strings (above), which is where the ESPN-shape logic is proven. Refresh
  `narration.json` so the offline run stays network-free.

### Scenario (the real proof)

Offline end-to-end run, then inspect the produced data and prose:

    node pipeline/run.js --fixtures test/fixtures --date 2026-06-12

- Assert `site/data/2026-06-12.json` `matches[].scorers[]` carry `assist`/
  `bodyPart`/`placement`/`penalty`/`ownGoal` (with `null` where unknown, never a
  missing key) and `matches[].stats` is populated `{ home, away }`.
- Re-narrate live (real model) on a fixture day and read the pills/summary: prose
  references manner/assist/stats naturally, in Romanian, with **no English words**
  and **no invented players** (every named player appears in the fact set).

## Conventions

ESM, Node 20+, all user-facing text Romanian with correct diacritics. New mapping
tables (English phrase → Romanian token) live in `enrich.js` next to the parser,
not inline. Personal project — push to github.com/mcandea04 only.

## Resolved decisions

These were open or raised by the spec-doubt panel; resolved here so implementation
has no pending choices:

1. **Card-reason language → option (b), Romanian token map.** No English reaches the
   model, consistent with goal manner. Table in component 1. Unknown reason → `null`.
2. **Assist only on `type.text === "Goal"`.** Verified: penalty has one participant,
   own-goal's `participants[1]` is the opponent. Component 2.
3. **Type matching is exact-string, safe by default.** An unknown ESPN type
   narrates as open-play (`penalty:false, ownGoal:false`), never mis-flagged.
4. **Stat values stay strings from `displayValue`** — no `Number()`, sidesteps the
   `"–"`→`NaN` case. Raw ESPN key names, no renaming. Component 3.
5. **Uniform null shape.** `parseMatch` defaults every new field to a value or
   `null`; the model never sees a missing key. Component 4 + the null-vs-absent box.
6. **Yellow-card reasons are parsed but only surface for dismissals**, because
   `events` filters to RED/second-yellow (unchanged today's behaviour). Intentional;
   a code comment in `fetch.js` will say so. Widening to yellows is later work.
7. **`stats` re-narrates via the hash projection** (component 6); the persisted JSON
   never loses fields because `run.js` rebuilds matches from fresh facts every run.

## Backward compatibility (archive)

Old `site/data/<date>.json` files (pre-this-change) lack the new fields. This is
safe now because `render.js` is untouched and reads none of them. When rendering is
added later, that work **must** read the new fields defensively
(`scorer.bodyPart ?? null`, `match.stats?.home`, etc.) so the archive's older
digests keep rendering. Called out here so the future render work doesn't assume
presence — no migration/backfill of old files is in scope.

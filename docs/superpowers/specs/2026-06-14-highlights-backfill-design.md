# Highlights backfill + stable teaser

GitHub issue #9: "Have an initial run after the last game ends but keep going
with runs until you update all the highlights links."

## Problem

The night digest publishes once every match has FINISHED (`--require-complete`).
But FIFA publishes its official highlight reels hours after a match ends, so the
first publish almost always has missing `highlight` links.

The trigger mechanism (cron-job.org pinger + GitHub schedule cron, every ~15 min
across the 21:00-10:00 UTC window) already re-runs the pipeline after the first
publish, and `writeIfChanged` already re-commits + re-deploys `<date>.json` as
each new reel appears. So highlight links **already** trickle onto the page.

Two real gaps remain:

1. **The teaser froze a stale count.** `buildTeaser` bakes the live recap count
   into the WhatsApp share text (`4 meciuri + 3 rezumate video azi-noapte`).
   That text is generated at first publish, before most reels exist, and the
   number it captures is wrong by the time all reels land. A share message
   already sent to the group can never be corrected.

2. **No early stop.** Once every link is in, runs keep re-deploying every 15 min
   until the window closes, doing no useful work.

## Decisions (from brainstorming)

- **Stop condition: publish only when this run changed the digest.** Keep the
  time window as the hard ceiling. Each run rebuilds the digest and deploys only
  if it differs from the stored one; once highlights and facts stop arriving the
  digest stabilizes and runs stop deploying. This is the concrete form of "keep
  running until all highlight links are updated, then stop," and it also catches
  late scorer/card/standings corrections that a narration-facts check would miss.
  A reel that never comes needs no special handling — the digest simply stops
  changing.
- **Teaser: generic, count-free clause.** Drop the recap count from the share
  text. When there are matches: `<headline> · N meciuri azi-noapte, cu rezumate
  video`. Without the count, the teaser string is stable across backfill runs
  (same headline + same match count), so the share text already sent to the
  group never goes stale. World Cup reels reliably come, so the generic promise
  is safe.
- **Backfill must be monotonic.** A highlight link, once stored, is never
  replaced by `null` on a later run — otherwise a transient FIFA feed outage
  (which soft-fails to an empty map) would wipe already-published links and
  reopen the early-stop chase.

## Design

### A. Teaser — count-free (`pipeline/teaser.js`)

`gamesLabel` drops the `recapCount` argument entirely. When `matchCount > 0` it
appends `, cu rezumate video` to the match-count phrase. The clause trails
`azi-noapte` with a comma — the exact byte order is load-bearing (it is asserted
in tests and the scenario), so the output strings are pinned literally:

    ⚽ <headline> · 4 meciuri azi-noapte, cu rezumate video
    ⚽ <headline> · 1 meci azi-noapte, cu rezumate video

So `gamesLabel(matchCount)` returns `${matches} azi-noapte, cu rezumate video`
for `matchCount > 0` (where `matches` is `1 meci` / `N meciuri`), and
`pauză azi-noapte` for zero (no clause — a no-match night has no reels).
`buildTeaser` loses its `recapCount` parameter.

The clause is appended whenever there are matches, even before any reel exists
(or on the rare night FIFA never covers a match). This is a deliberate
over-promise: World Cup reels reliably come, and a count-free generic clause is
what keeps the share text stable across backfill (see below). The old code only
mentioned recaps when `recapCount > 0`; that conditional is gone on purpose.

`run.js` stops passing `recapCount` to `buildTeaser` (the `recapByMatch.size`
argument at the `buildTeaser` call site is removed). `recapByMatch` is still
used for the per-match `highlight` field.

**Teaser stability is by construction, not a literal freeze.** `buildTeaser` is
recomputed every run from `narration.headline` (reused via the prose freeze) and
`facts.finished.length` (stable for a given night). The recap count is gone, so
the teaser string is byte-identical across backfill runs even though the
per-match `highlight` fields in `<date>.json` change. `writeIfChanged` still
rewrites the file when a new link lands — only the `teaser` field within it
stays put.

### B. Monotonic highlight merge (`pipeline/run.js`) — REQUIRED, not optional

Today the digest sets `highlight: recapByMatch.get(m.id) ?? null` — it rebuilds
the highlight set from scratch every run. `fetchRecaps` soft-fails to an **empty
map** on any FIFA feed outage (`highlights.js:116`), so a single transient
outage during the backfill window would overwrite every already-stored link with
`null`, `writeIfChanged` would re-commit the regression, and the early-stop gate
(section C) would then read the nulled digest, decide highlights are incomplete,
and reopen the chase. One outage both wipes published links and defeats the gate.

The backfill must therefore be **monotonic**: a link, once stored, is never
replaced by `null`. The merge prefers a freshly fetched link, then falls back to
the stored link, then `null`:

    const existingHighlightById = new Map(
      (existing?.matches ?? []).map((m) => [m.id, m.highlight]),
    );
    // ... per finished match m:
    highlight: recapByMatch.get(m.id) ?? existingHighlightById.get(m.id) ?? null

This keeps a real (non-empty) fresh fetch authoritative — so a corrected URL
still wins — while a feed outage (empty map) leaves stored links untouched.
`highlights.js` itself is unchanged; the merge lives in `run.js` where the
digest is assembled, using the same `existing` digest the freeze and gate read.

Two invariants the merge silently depends on, stated so they are not broken:

- **Match `id` is stable across runs.** The merge keys stored→fresh by `m.id`.
  football-data ids are stable for a scheduled match, so a stored link re-keys
  correctly on the next run. (If a match leaves `facts.finished` entirely — a
  status flip, a window-boundary change — its row and its stored link drop from
  the digest; that is correct, the match is no longer part of the night.)
- **`recapByMatch` only ever holds truthy URL strings, never `null`/`""`.**
  `getRecaps`/`recapsFor` build the map from found reels only (a missing reel is
  an absent key, not a stored falsy value), so the `??` chain falls through to
  the stored link exactly when no fresh link was found. A future change that put
  a falsy value into the map would defeat monotonicity.

### C. Publish-only-on-change gate (`pipeline/run.js`, under `--require-complete`)

The stop signal issue #9 asks for ("keep running until all highlight links are
updated, then stop") is exactly **"publish only when this run changed the
digest."** Build the digest as usual (with the monotonic merge), serialize it,
and compare it byte-for-byte against the stored `<date>.json`. Under
`--require-complete`, when the new digest is identical to the stored one and the
OG image already exists, the run has nothing to deploy: log `nothing changed;
already published`, set `published=false`, and return before the commit/deploy
outputs. Otherwise publish as today.

This is strictly better than gating on `factsHash` + a highlight-completeness
helper, and it is why neither is used:

- **It never skips a real correction.** `factsHash` is a *narration* projection
  — `facts-hash.js` hashes only `{date, finished:{id,score}, tonight:{id,home,
  away,kickoffEEST}}` and deliberately omits scorers, cards, penalties, and
  standings (the fields this project enriches *late* from ESPN). A
  `factsHash`-based skip would therefore drop a late scorer/card/standings
  correction whenever highlights happened to be complete. A full-digest byte
  compare catches every published field — scores, scorers, cards, standings,
  prose, teaser, and highlights — so any real change still deploys.
- **Highlight completeness becomes emergent, not a separate check.** A run that
  lands a new link produces a different digest → deploys. Once no new link
  arrives and no fact changes, the digest stabilizes → the next run is identical
  → stops. A night FIFA never fully covers also stops as soon as its data stops
  changing, instead of churning to the window ceiling — a small improvement over
  the original "all present" idea, which would have kept re-deploying such
  nights every 15 minutes.

The comparison uses the same `existing` digest the freeze and the merge read.
That read currently lives inside the `if (!args.reNarrate)` block (`run.js:244`);
the merge (section B) and this gate both need `existing` regardless of
`--re-narrate`, so lift the read above that block — freeze, merge, and gate then
share one read. A `--re-narrate` run regenerates prose, so its rebuilt digest
differs from the stored one and it always publishes; the gate never suppresses a
forced re-narration.

The gate compares only in-memory state against the stored file (no network), so
unlike the live readiness gate it is exercised under `--fixtures` too — which is
what makes the offline scenario below runnable. The gate is a no-op when there is
no stored digest yet (first publish always deploys).

### D. No changes to

- `digest.yml` / `freshness-alarm.yml` / the trigger crons — the every-15-min
  re-run that performs the backfill is unchanged.
- `fetch.js` readiness gate — first-publish timing is unchanged.
- `highlights.js` — fetching/keying is unchanged (the monotonic merge lives in
  `run.js`, not here).
- `manifest.json` recap counts — the archive's per-day recap badge is separate
  from the teaser. It is rebuilt on every *deploying* run; when the gate skips a
  no-change run it also skips the manifest rebuild, so a recap badge for a
  *different* day that changed out-of-band could lag by one run. It self-heals on
  the next deploying run and only affects an archive badge, so this is acceptable.

## Tests

- **`test/teaser.test.js`** — rewrite for the count-free output: matches →
  `, cu rezumate video` appended (plural and singular match phrasing); zero
  matches → `pauză azi-noapte` with no clause; `buildTeaser` no longer takes
  `recapCount`.
- **Monotonic merge** unit coverage (the merge expressed as a small pure helper
  so it is testable without a full run): a stored link + an empty fresh recap
  map (outage) → stored link survives (not nulled); a fresh link + a different
  stored link → fresh link wins (correction); no stored + no fresh → `null`.
- The publish-only-on-change gate is proved by the scenario (it needs a stored
  digest on disk and `--require-complete`, so it is an integration check, not a
  unit test).

## Scenario (proof)

Offline `--fixtures` runs are the proof, all against the same `--out` dir so each
run reads the prior run's stored digest. `test/fixtures/matches.json` has exactly
**two** FINISHED matches in the 2026-06-12 night window (537327 Mexico v South
Africa, 537328 Canada v Qatar); ids 537330/537331 are `TIMED` (tonight's
fixtures) and never enter `digest.matches`. So `matchCount` is 2. The default
`highlights.json` already covers both finished matches.

To prove the *partial* backfill (one link missing, then arriving) the proof
starts from a reduced one-of-two highlights feed, not the default:

1. First run, feed covering only 537327, `--require-complete`: publishes; the
   `teaser` field reads `⚽ <headline> · 2 meciuri azi-noapte, cu rezumate
   video` (no number); 1 of 2 matches carries a `highlight`.
2. **Monotonic-merge proof:** re-run with an empty feed (simulated outage),
   `--require-complete`: the one stored link survives (not nulled). With no other
   field changing, the rebuilt digest equals the stored one, so the run also logs
   `nothing changed; already published` — an outage neither wipes the link nor
   forces a redundant deploy.
3. Re-run with the full default feed (covers both), `--require-complete`: the
   second link is written, so the digest differs from the stored one → publishes;
   `teaser` field byte-identical to step 1 (assert on the field, not the file —
   the highlight field changed).
4. Re-run again, same full feed, `--require-complete`: the rebuilt digest is
   byte-identical to the stored one → logs `nothing changed; already published`,
   `published=false`, deploys nothing. This is the auto-stop.

The plan's Task 6 runs an equivalent five-step sequence (it also adds a
four-match variant by patching two `TIMED` fixtures into the window) and Task 5
encodes steps 1→3→4 as integration tests in `run.test.js`.

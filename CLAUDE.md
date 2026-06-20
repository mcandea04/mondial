# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Mondialul de dimineață" — a static site rebuilt once per night that tells a group of
Romanian friends what happened overnight at the 2026 World Cup, in Romanian (with an English
side), at a glance. Read `SPEC.md` for the full product spec; it is the source of truth for
behavior and phasing.

## Commands

```
npm ci                                  # install (Node 20, see .nvmrc)
npm test                                # node --test over test/
node --test test/standings.test.js      # run one test file
npm run digest                          # live pipeline run (ESPN needs no key; narration needs a key/engine)
node pipeline/run.js --date 2026-06-12  # live run for a specific date
node pipeline/run.js --fixtures test/fixtures --date 2026-06-12   # offline run, no API calls
node pipeline/run.js --require-complete  # no-op unless every match of the night has finished
node pipeline/run.js --re-narrate        # force fresh prose even when stored facts are unchanged
node pipeline/run.js --steer "<text>"    # append a one-shot steering note to the narration prompt
node pipeline/run.js --out tmp/out       # redirect data writes, skip the live index.html OG mutation
node pipeline/backfill-en.js             # one-time: add the English side to committed days
```

Secrets load from `.env` (gitignored) at the start of every run; see `.env.example` for the keys
(`GEMINI_API_KEY`, optional `GEMINI_MODEL`, `SITE_URL`). The Opus narrator instead spends a Pro
subscription via `CLAUDE_CODE_OAUTH_TOKEN` (it shells out to the `claude -p` CLI). There is no
build step and no lint config — the site is vanilla HTML/CSS/JS served straight from `site/`.

## Offline development

`--fixtures <dir>` is the way to work without hitting any API. It reads `scoreboard.json`,
`summary-<id>.json`, and `espn-standings.json` from the dir instead of calling ESPN, plus
(optionally) `narration.json` instead of the narrator. `test/fixtures/` holds a working sample
set. When `narration.json` is absent the run still calls the narrator, so include it to stay
fully offline. Fixtures runs default their writes to `tmp/out/` and skip the `index.html` OG
mutation. Fixtures handling only applies to the Gemini narrator paths; the Opus paths always
call the live CLI.

## Core principle (do not violate)

**Code establishes facts, the model writes the drama.** Scores, scorers, minutes, cards,
standings, qualification math, and highlight URLs are computed/fetched in `pipeline/` and merged
back verbatim in `run.js`. The narrator only produces voice: headline, summary, per-match `pill`,
`drama` rating, and tonight `alarm`/`why`. The model never has authority over a fact — its output
is keyed back to facts by match `id`, and anything it omits falls back to a default. Any change
that lets narration originate a score, scorer, qualification claim, or highlight link is a bug.

## Pipeline flow (`pipeline/run.js` orchestrates)

1. `espn.js` — ESPN public-API client (the sole fact source for results; no key). Defines the
   EEST "night window" (`[D-1 16:00 UTC, D 06:00 UTC)`) and splits the scoreboard into last
   night's `finished` games and `tonight`'s fixtures, enriching finished matches with
   scorers/cards/stats from each event summary and reshaping ESPN into the match shape the rest
   of the pipeline consumes. A match is "over" when ESPN reports `completed===true`;
   `digestReadiness()` powers the `--require-complete` gate. Times are computed against
   `Europe/Bucharest` via `Intl` — never hardcode offsets.
2. `standings.js` — group status classification with the **2026 H2H tiebreaker**. When teams
   finish level on points the first tiebreaker is head-to-head among the tied teams (not overall
   goal difference). A team is only `calificată`/`eliminată` when no outcome could change it
   (ties stay `în cărți`). 2026 format: 12 groups of 4, top 2 advance + 8 best thirds.
3. `highlights.js` — official FIFA highlight reels, fetched from FIFA's public section-news feed
   (no key) and keyed to a finished match by kickoff time (±90 min, to absorb FIFA's metadata
   lag) plus country code. A highlight URL is a fact, not voice. A feed outage soft-fails to an
   empty map and never breaks the digest.
4. **Narration layer** (see "Narrator engines" below) — turns verified facts into RO + EN voice,
   validated with zod, then merged back by `id`.
5. `og-image.js` — 1200×630 PNG per day via satori + resvg (bundled Inter fonts).
6. `teaser.js` — WhatsApp share text (RO + EN).

`run.js` writes `site/data/<date>.json` + `latest.json` + `og/<date>.png`, rebuilds
`manifest.json` (the archive index, including per-day recap counts), and token-replaces the OG
block in `index.html` between the `<!-- og:start -->`/`<!-- og:end -->` markers. On any failure it
leaves `latest.json` untouched and exits non-zero so the workflow skips commit + deploy.

## Narrator engines

The voice prompt, output schema, and user-message builder live in `narration-core.js` so every
engine competes on the identical contract. `run.js` `getNarration()` picks the engine from the
`NARRATOR` env var (a GitHub repo *variable* in prod):

- `gemini` — single-pass Gemini (`narrate.js`). Default model `gemini-3-flash-preview` with a
  GA `gemini-2.5-flash` fallback ladder; retries transient 429/5xx and once on bad JSON/schema.
- `gemini-polish` — **prod default**: Gemini draft → idiom critique → rewrite (`narration-polish.js`
  with the Gemini engines in `gemini-engine.js`). If polish fails the validated draft ships.
- `opus` — single-pass headless `claude -p` (`claude-engine.js`), billed to the Pro subscription.
- `opus-polish` — Opus draft → idiom critique → rewrite. Polish failure ships the draft.

The polish critique flags only calques/unnatural phrasing — never facts, never jokes — and the
rewrite re-derives from the original facts message (keyed by `id`), so the critique can never
originate a fact. An Opus auth failure falls back to Gemini immediately rather than burning retries.

**Bilingual:** every prose field is stored as `{ ro, en }`. The English pass uses the EN prompt
and schema; the English `alarm` is always the Romanian verdict mapped to English (never the EN
model's own watch/skip call), so the two languages never disagree. Legacy days that stored a flat
string still render (read via `localizeNarrator`/`localizeProse`).

## Freeze and prose reuse

A published day is frozen: re-running it reuses the stored prose instead of re-narrating, so an
unrelated table shift doesn't churn the morning's jokes.

- `facts-hash.js` projects each digest down to the *narrated* facts — score, scorer
  (name/minute/team/penalty/ownGoal), dismissals — and hashes them stably (order- and
  key-independent). Soft fields (assists, body part, card reason, stats, full standings) are
  deliberately excluded: they get revised post-whistle and would re-narrate for no narrative gain.
- `prose-reuse.js` rebuilds the narration from the stored digest (matched by `id`, falling back to
  home+away for pre-id days). Returns `null` when it can't fully cover the current facts → re-narrate.
- `run.js` publishes only on a *byte* change under `--require-complete` (so a late scorer/card/
  standings correction still deploys even though `factsHash` ignores it), and emails only when
  fresh prose was actually generated (`narrationChanged`). `--re-narrate` overrides the freeze.

## Gold archive

`gold.js` + `gold.json` hold a small hand-blessed set of narration lines the owner loved, fed back
into the prompt as few-shot taste examples (the positive mirror of the avoid-list). Promoting a
line affects FUTURE nights only — it does not re-narrate today. Lines are added by the owner
opening a `gold`-labeled issue (see Deployment); a per-field FIFO cap bounds the prompt.

## Team names

`teams.js` maps ESPN English names to Romanian exonyms (plus FIFA ranks and flag codes) and FIFA
tricodes to flag codes (used by `highlights.js`). Unknown names (knockout placeholders) pass
through. Add new mappings here, not inline.

## Site (`site/`)

Vanilla, mobile-first. `assets/render.js` renders a digest JSON into the DOM and is shared by
`index.html` (loads `data/latest.json`) and `arhiva.html` (date picker over `manifest.json`).
`i18n.js` holds pure localization helpers (no DOM); `lang.js` (RO/EN) and `theme.js` (light/dark)
persist the user's choice in `localStorage` and mount segmented toggles via `segmented.js`. The
data files in `site/data/` are committed to git — that is the archive, and per-day digests are the
only persistence layer.

GoatCounter (anonymous, cookieless) counts visits via `count.js`. To stop counting your own visits
on a browser, open `https://mcandea04.github.io/mondial/#toggle-goatcounter` once — it sets
`localStorage.skipgc='t'`. Per-origin, per-browser; re-run to toggle back. Resets if you clear
site data or use a private window.

## Deployment (GitHub Actions)

- `digest.yml` polls every 15 min across the night window, runs the pipeline with
  `--require-complete`, and only commits + deploys to Pages when the night is over. It deploys in
  the **same run** because commits made with `GITHUB_TOKEN` don't trigger other workflows. Needs
  `contents: write, pages: write, id-token: write`. `published=true` (set via `$GITHUB_OUTPUT`)
  gates the commit/deploy/email steps. A `workflow_dispatch` with `force=true` runs `--re-narrate`
  (skips the completeness gate); an optional `steer` input becomes a one-shot prompt note.
- `deploy.yml` — manual `workflow_dispatch` that deploys the committed `site/` without running the
  pipeline. Use after a manual content edit or a restore, when re-narrating would lose data.
- `re-narrate.yml` — owner-only, triggered by a labeled issue. `re-narrate` label → dispatch
  `digest.yml` `force=true` with the issue body as a steering note (regenerate today's prose).
  `gold` label → append the issue body's lines to `pipeline/gold.json` and push (taste for future
  nights; does NOT re-narrate today).
- `freshness-alarm.yml` — dead-man switch: runs after the night window closes
  (`scripts/check-digest-fresh.js`) and emails an alarm if `latest.json` isn't today's, so a total
  trigger failure is noticed instead of discovered by chance.
- All digest-related workflows share the `concurrency: digest` group so a deploy, a digest run, and
  a gold push never collide.
- The narrator engine is the `NARRATOR` GitHub repo *variable* (`gemini-polish` is the prod
  default). Flip it from the GitHub settings UI, not in code.
- **Verify digest/prose changes by running the real Action end to end**, not just unit tests:
  dispatch `digest.yml` with `force=true` to regenerate a committed day with the current narrator.
  Prose quality is judged by eye on the live output; the committed `site/data/*.json` can always be
  reverted if the result is worse.
- `scripts/check-fifa-highlights.js` is a manual live check (not a unit test) that audits the FIFA
  feed against the tricode→flag map; run it against a multi-match feed before trusting the table.

## Conventions

- ESM only (`"type": "module"`), Node 20+.
- All user-facing Romanian text uses correct diacritics (ă â î ș ț); user text is bilingual RO/EN.
- This is a `~/personal/` project: push to **github.com/mcandea04** only, never a work account.

## Specs and plans are throwaway

Brainstorming specs and implementation plans (the `docs/superpowers/` files the superpowers flow
produces) are working artifacts, not repo content. Write them in the gitignored worktree while
doing the work, and let them die with the worktree — do NOT commit them to the repo and do NOT
include them in the feature PR. The feature PR is pure code (implementation + tests). The commit
messages and the PR description are the durable record; there is no separate design doc and no
design issue. Older `docs/superpowers/specs|plans/*` files predate this rule; leave them, but add
no new ones.
</content>
</invoke>

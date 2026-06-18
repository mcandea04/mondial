# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Mondialul de dimineață" — a static site rebuilt once per night that tells a group of
Romanian friends what happened overnight at the 2026 World Cup, in Romanian, at a glance.
Read `SPEC.md` for the full product spec; it is the source of truth for behavior and phasing.

## Commands

```
npm ci                                  # install (Node 20, see .nvmrc)
npm test                                # node --test over test/
node --test test/standings.test.js      # run one test file
npm run digest                          # live pipeline run (needs GEMINI_API_KEY; ESPN needs no key)
node pipeline/run.js --date 2026-06-12  # live run for a specific date
node pipeline/run.js --fixtures test/fixtures --date 2026-06-12   # offline run, no API calls
node pipeline/run.js --require-complete  # no-op unless every match of the night has finished
```

Secrets load from `.env` (gitignored) at the start of every run; see `.env.example` for the keys.
There is no build step and no lint config — the site is vanilla HTML/CSS/JS served straight from `site/`.

## Offline development

`--fixtures <dir>` is the way to work without hitting either API. It reads `scoreboard.json`,
`summary-<id>.json`, and `espn-standings.json` from the dir instead of calling ESPN, plus
(optionally) `narration.json` instead of Gemini. `test/fixtures/` holds a working sample set.
When `narration.json` is absent the run still calls Gemini, so include it to stay fully offline.

## Core principle (do not violate)

**Code establishes facts, the model writes the drama.** Scores, scorers, minutes, cards,
standings, and qualification math are computed in `pipeline/` and merged back verbatim in
`run.js`. The Gemini call (`narrate.js`) only produces voice: headline, summary, per-match
`pill`, `drama` rating, and tonight `alarm`/`why`. The model never has authority over a fact —
its output is keyed back to facts by match `id`, and anything it omits falls back to a default.
Any change that lets narration originate a score, scorer, or qualification claim is a bug.

## Pipeline flow (`pipeline/run.js` orchestrates)

1. `espn.js` — ESPN public-API client (the sole fact source; no key). Defines the EEST
   "night window" (`[D-1 16:00 UTC, D 06:00 UTC)`) and splits the scoreboard into last
   night's `finished` games and `tonight`'s fixtures, enriching finished matches with
   scorers/cards/stats from each event summary and reshaping ESPN into the match shape the
   rest of the pipeline consumes. A match is "over" when ESPN reports `completed===true`;
   `digestReadiness()` powers the `--require-complete` gate. Times are computed against
   `Europe/Bucharest` via `Intl` — never hardcode offsets.
2. `standings.js` — Phase 1 status classification. Point-based math only; a team is only
   `calificată`/`eliminată` when no tiebreaker could change it (ties stay `în cărți`). The exact
   scenario engine (`scenarios.js`, tiebreakers, best-thirds) is Phase 2 and not built yet.
3. `narrate.js` — Gemini call, strict structured output validated with zod, retries on
   transient 429/5xx and once on bad JSON/schema. Default model `gemini-3-flash-preview`
   (pro tiers 429 on the free key). Recent days' prose is fed in so it avoids recycling jokes.
4. `og-image.js` — 1200×630 PNG per day via satori + resvg (bundled Inter fonts).
5. `teaser.js` — WhatsApp share text.

`run.js` writes `site/data/<date>.json` + `latest.json` + `og/<date>.png`, rebuilds
`manifest.json` (the archive index), and token-replaces the OG block in `index.html` between
the `<!-- og:start -->`/`<!-- og:end -->` markers. On any failure it leaves `latest.json`
untouched and exits non-zero so the workflow skips commit + deploy.

## Team names

`teams.js` maps ESPN English names to Romanian exonyms (plus FIFA ranks and flag codes).
Unknown names (knockout placeholders) pass through. Add new mappings here, not inline.

## Site (`site/`)

Vanilla, mobile-first. `assets/render.js` renders a digest JSON into the DOM and is shared by
`index.html` (loads `data/latest.json`) and `arhiva.html` (date picker over `manifest.json`).
The data files in `site/data/` are committed to git — that is the archive, and per-day digests
are the only persistence layer.

GoatCounter (anonymous, cookieless) counts visits via `count.js`. To stop counting your own
visits on a browser, open `https://mcandea04.github.io/mondial/#toggle-goatcounter` once — it
sets `localStorage.skipgc='t'`. Per-origin, per-browser; re-run to toggle back. Resets if you
clear site data or use a private window.

## Deployment (GitHub Actions)

- `digest.yml` polls every 15 min across the night window, runs the pipeline with
  `--require-complete`, and only commits + deploys to Pages when the night is over. It deploys
  in the **same run** because commits made with `GITHUB_TOKEN` don't trigger other workflows.
  Needs `contents: write, pages: write, id-token: write`. `published=true` (set via
  `$GITHUB_OUTPUT`) gates the commit/deploy/email steps.
- `deploy.yml` — manual `workflow_dispatch` that deploys the committed `site/` without running
  the pipeline. Use after a manual content edit or a restore, when re-narrating would lose data.
- Both share the `concurrency: digest` group so a deploy and a digest run never collide.
- The narrator engine is the `NARRATOR` GitHub repo *variable* (`gemini-polish` is the
  prod default: Gemini draft → idiom critique → rewrite; also `gemini`, `opus`,
  `opus-polish`). Flip it from the GitHub settings UI, not in code.
- **Verify digest/prose changes by running the real Action end to end**, not just unit
  tests: dispatch `digest.yml` with `force=true` (runs `--re-narrate`) to regenerate a
  committed day with the current narrator. Prose quality is judged by eye on the live
  output; the committed `site/data/*.json` can always be reverted if the result is worse.

## Conventions

- ESM only (`"type": "module"`), Node 20+.
- All user-facing text is Romanian with correct diacritics (ă â î ș ț).
- This is a `~/personal/` project: push to **github.com/mcandea04** only, never a work account.

## Specs and plans are throwaway

Brainstorming specs and implementation plans (the `docs/superpowers/` files the
superpowers flow produces) are working artifacts, not repo content. Write them in
the gitignored worktree while doing the work, and let them die with the worktree —
do NOT commit them to the repo and do NOT include them in the feature PR. The
feature PR is pure code (implementation + tests). The commit messages and the PR
description are the durable record; there is no separate design doc and no design
issue. Older `docs/superpowers/specs|plans/*` files predate this rule; leave them,
but add no new ones.

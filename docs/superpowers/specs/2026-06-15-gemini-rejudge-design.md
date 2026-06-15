# Re-judge Gemini vs the live Opus prose (issue #19)

**Date:** 2026-06-15
**Status:** Draft — revised after spec-doubt (2 critical + 3 high fixed)
**Issue:** #19 (Cloud Opus mangling the digest)

## Problem

The digest narrator switched to Opus (`opus-polish`) on the strength of a
2026-06-12 prose benchmark. That benchmark is now **stale**: it ran on the
*old* `SYSTEM_PROMPT`, before two later changes landed —

- `#18` (`03e78ac`) — natural-Romanian prompt: foot/stat restraint, named-calque
  seeds, dropped pill label;
- `#17` (`e7ab3b9`) — the `opus-polish` engine (draft → idiom critique → rewrite).

Nobody re-judged Gemini against Opus on the *current* prompt. Meanwhile the
shipped Opus prose shows the defects in issue #19: clumsy Romanian, and a
backwards watch recommendation (told the reader to stay awake for one game while
reading another in the morning).

This spec covers **only** the "redo the benchmark, I judge it myself" thread of
issue #19. It is a one-off judging harness, not production wiring.

## Out of scope (deliberately deferred)

Decided only **after** the user has judged the output:

- Flipping the production `NARRATOR` env var to Gemini.
- Reviving the full blind `bench/` harness from branch
  `claude/nostalgic-cori-219e3a` (its fact-days are stale — pre-richer-facts
  string scorers — so only the directory idea would survive, not its contents).
- Deterministic lint evals (exclamation count, foot-mention count, calque
  blocklist) and the regression-prevention framework issue #19 also asks for.
- Any change to the `tonight` alarm/why logic (the backwards-recommendation bug).

Guessing these before seeing results would be premature. They become a follow-up
once the judging is done.

## Core principle (unchanged, load-bearing)

**Code establishes facts, the model writes the drama.** This harness only
regenerates *voice* from already-verified facts. It never lets a model originate
a score, scorer, minute, card, or qualification claim. Reconstructed facts are
proven identical to the live ones via `factsHash` where a stored hash exists —
with the explicit limit on what that hash covers, stated below.

## Source ref: where the day files come from (NOT local disk)

Local `main` has **diverged** from `origin/main`: the seven `digest: 2026-06-15`
commits — which is where `site/data/2026-06-15.json` and every distinct Jun-15
Opus run live — are on `origin/main` and **not** reachable from local `HEAD`
(merge-base is `33d63b1`, the Jun-14 base). The local working tree also carries
unrelated in-progress work (`pipeline/fetch.js`, a re-narrated `latest.json`), so
rebasing local main is off the table.

Therefore the harness reads every fact-day from a **git ref**, default
`origin/main`, via `git show <ref>:site/data/<date>.json` — never from the working
tree. The ref is a constant at the top of the script (`SOURCE_REF = 'origin/main'`).
The script runs `git fetch origin` once at start (best-effort; on failure it warns
and proceeds with whatever `origin/main` is locally known). Reading `2026-06-15.json`
from the working tree would 404 (it is not on local HEAD) — this is the C2 fix.

## Inputs: reconstructing the `narrate()` input

Each day file (read from `SOURCE_REF`) carries everything `narrate()` consumed.
The harness reconstructs the input `{ date, finished, tonight, standings }`:

- `finished` ← `matches[]` with the model-authored fields (`pill`, `drama`,
  `highlight`) stripped back out, keeping the facts (`id, home, away, score,
  scorers, events, decidedOnPenalties, group, utcDate`, and `stats` where
  present). The `scorers`/`events` objects are kept **verbatim** — they are the
  same enriched dicts `parseMatch` produced and `factsHash` hashed at write time,
  so the gate (below) can round-trip.
- `standings` ← `groups[]`, already in the classified shape
  `{ name, table: [{ team, code, p, w, d, l, gd, pts, status }] }` that
  `classifyStandings` emits and `buildUserMessage` serializes. **Limit:** the
  stored `groups[]` is whatever the page showed; the live `narrate()` saw the
  full `classifyStandings` output. They may differ in group membership. The hash
  gate does NOT police this (it excludes standings — see below).

- `tonight` ← `tonight[]` with `alarm`/`why` stripped, keeping
  `{ id, home, away, homeCode, awayCode, kickoffEEST }` (and `group`/`utcDate`
  when present).

**Faithfulness gate — and what it does NOT prove.** For days with a stored
`factsHash` (Jun 14, Jun 15), recompute `factsHash` on the reconstructed input
and assert equality with the stored top-level `factsHash` field. `factsHash`
(`pipeline/facts-hash.js`) projects **only** `{ date, finished:[{id, score,
scorers, events}], tonight:[{id, home, away, kickoffEEST}] }`. It **excludes**
`stats`, `standings`, `group`, `utcDate`, `homeCode`/`awayCode`, and
`decidedOnPenalties`. So a passing gate proves the **scores, scorers, and tonight
basics** round-trip — it does **not** prove `stats` or `standings` were
reconstructed identically to the live input, even though the prose draws on them
(Jun-14's headline is about a 26-shots stat). This is an accepted limit, recorded
in the output, not a guarantee the spec pretends to. A mismatch aborts that day
loudly (skip the day, continue the others; see "Failure policy").

Jun 12/13 predate the hash and have no `stats`; they are reconstructed without the
gate, and the output records "no stats / no hash gate" for them.

Which days to judge:

- **2026-06-12** — 2 finished matches. Live prose = Gemini, old prompt (inferred:
  no `narrator` field, predates the marker). No stats, no hash gate.
- **2026-06-13** — 2 finished matches. Live prose = Gemini, old prompt (same
  inference). No stats, no hash gate.
- **2026-06-14** — 4 finished matches. Live prose = `opus-polish`. Has stats,
  has `factsHash` → gated.
- **2026-06-15** — 4 finished matches (Germania 7-1 etc.). Live prose =
  `opus-polish`. Has stats, has `factsHash` → gated. `origin/main` history holds
  several distinct Opus runs of this day (see "Opus-history sampling").

`2026-06-11` is a no-matches night and is **skipped** — the four match-nights
above are the judging set.

## Candidates per day

Base set is **three candidates** per day; Jun 15 adds the Opus-history column for
**five**. All render only the four model-authored fields (headline, summary,
per-match pills, tonight lines):

1. **existing** — the live prose for that day, read verbatim from `SOURCE_REF`'s
   day file. No regeneration. Labeled with its narrator (`gemini` old-prompt for
   12/13, `opus-polish` for 14/15).
2. **gemini** — fresh single-pass on the **current** prompt at `SOURCE_REF`'s
   `narration-core.js` with the **B strip** (below), via the harness's own Gemini
   caller (production `narrate()` cannot take a custom system prompt — see "Gemini
   transport"). Model = `narrate.js`'s `DEFAULT_MODEL` (`gemini-3-flash-preview`).
3. **gemini-critique** — Gemini draft → Gemini idiom critique → Gemini rewrite.
   The draft and rewrite use the **B-stripped** `SYSTEM_PROMPT`; the critique uses
   the **A-stripped** `CRITIQUE_SYSTEM_PROMPT` (A lives only in the critique
   prompt, B only in the system prompt — they are disjoint, see "A/B/C strip").

**recentProse (decision — was unspecified).** The live prose was written WITH the
prior days' prose fed in (the production anti-recycling context). To keep the
comparison fair, the harness **replicates that lookup**: for each judged day it
reads the up-to-3 prior days' prose from `SOURCE_REF` day files (the same
`headline`/`summary`/`pill`/`why` lines `recentProseBefore` collects in `run.js`)
and passes them as `recentProse`. `recentProseBefore` is not exported, so the
harness reimplements the small lookup against `SOURCE_REF` (documented duplication,
~15 lines). Jun-12 has only the no-match Jun-11 before it → near-empty list; that
is correct, not a bug. `steer` is always null in the bench.

**Opus-history sampling (Jun 15 only).** `origin/main` holds several distinct
Opus runs of Jun-15. The harness selects them **deterministically**: list the
commits touching `site/data/2026-06-15.json` on `SOURCE_REF`
(`git log --format=%H SOURCE_REF -- site/data/2026-06-15.json`), read each one's
headline, and take the **first two commits with distinct headlines** (newest
first). They render as read-only candidates labeled `opus-history (<short-sha>)`.
**No Opus calls** — pulled verbatim from git. If fewer than two distinct headlines
exist, take what there is; if the file is absent at a listed commit, skip it.
These candidates are exempt from the hash gate and the id-subset check (they are
historical output, not regenerated) — they render as-is, tolerant of an older
schema (missing fields render blank).

## A/B/C strip (Gemini variants only)

The current prompt is tuned for Opus: it names calques reverse-engineered from
*Opus* output. For Gemini those names are noise. The harness builds
Gemini-specific prompt strings **at run time from `SOURCE_REF`'s
`narration-core.js`** (production is **not** modified). The two strips target
**disjoint** prompts — there is no prompt that needs both:

- **B** lives only in `SYSTEM_PROMPT` → applies to the **gemini** single-pass and
  to the **draft + rewrite** of gemini-critique (the rewrite base embeds
  `SYSTEM_PROMPT` via `buildRewriteSystemPrompt`, so the rewrite base must be
  B-stripped too — see "Gemini transport").
- **A** lives only in `CRITIQUE_SYSTEM_PROMPT` → applies only to the **critique**
  call of gemini-critique.
- **C** stays everywhere.

Because the strips are surgical edits on prose that may drift, the harness must
**fail loudly if the target span is not found** (rather than silently shipping an
unstripped prompt). The prompts are template literals with **real newlines and
2-space indentation**, so the target spans wrap across physical lines. The strip
therefore matches **whitespace-tolerantly**: build a regex from the quoted span by
splitting on whitespace and joining with `\s+` (each interior run of spaces/
newlines/indent matches `\s+`), then `String.replace(regex, replacement)`. If the
regex finds no match (prompt changed upstream), the script aborts with "B-strip
target not found — prompt drifted, update the bench." The quoted spans below are
written on one line for readability; the regex makes the line-wrapping irrelevant.

**B-strip — `SYSTEM_PROMPT`, stats bullet.** This is a *full-span substitution*,
not a partial "drop" — the replacement also collapses the sentence. Replace this
exact span:

    Nu înșiri tabele și nu calchia engleza: în loc de „posesia n-a plătit nimic" (traducere proastă) spui „degeaba a ținut mingea, că tot acasă a plecat" sau „posesia n-a contat".

with exactly:

    Nu înșiri tabele și nu calchia engleza din rezumate.

(Everything before "Nu înșiri" and the trailing "La 0-0 fără tâlc..." stay
untouched. The net effect: the named-calque seed is gone, the restraint rule
remains.)

**A-strip — `CRITIQUE_SYSTEM_PROMPT`, calque bullet + portar bullet.** Two exact
substitutions. (1) In the calque bullet, replace this exact span:

    „a restabilit egalitatea" în loc de „a egalat", „posesia n-a plătit /
    n-a plătit nimic" în loc de „degeaba a ținut mingea" sau „posesia n-a contat", „victorie
    limpede" în loc de „victorie fără emoții" sau „a câștigat fără să tremure")

with exactly:

    „a restabilit egalitatea" în loc de „a egalat")

(keeps `„un cap de X"`, `„poarta intactă"`, `„a restabilit egalitatea"`; removes
the two Opus-specific named calques *with their replacement tails*, leaving the
parenthetical grammatical). (2) Remove the whole portar bullet line:

    - construcții eliptice la portar („a scos de N ori" cere un obiect; spui „a avut N
      intervenții" sau „a scos N mingi")

Keep the generic instruction, the `„a deschis"` → `„a deschis scorul"` structural
example, and the topică / prepoziții / anglicisme bullet.

**C — foot-restraint and stat-restraint paragraphs STAY** in the Gemini
`SYSTEM_PROMPT`. They are general voice guidance, not Opus-specific.

## Gemini transport (the C1 fix — narrate() can't take a custom prompt)

`narrate()`/`callGemini` **hardcode** the imported `SYSTEM_PROMPT` and the
JSON `responseSchema` (`narrate.js:61`); neither accepts a custom system prompt.
So the B-stripped single-pass and the A-stripped plain-text critique **cannot**
go through `narrate()`. The "reuse narrate, no duplication" idea is dropped.

Instead the harness owns **one small Gemini caller** with an injectable system
prompt and an optional schema:

    callGeminiRaw({ apiKey, model, systemPrompt, userMessage, schema /* or null */ })

It mirrors `narrate.js`'s `callGemini` (same endpoint, `x-goog-api-key`,
`temperature: 0.8`) but: takes `systemPrompt` as a parameter; sets
`responseMimeType: 'application/json' + responseSchema` only when `schema` is
non-null (the critique passes `null` → plain text). It carries the **same retry
taxonomy** as `narrate()` (429/5xx → backoff, one schema/JSON retry) — extracted
or duplicated, the script owns it. `narration-core` is still imported for
`SYSTEM_PROMPT`, `CRITIQUE_SYSTEM_PROMPT`, `narrationSchema`, `buildUserMessage`,
`buildRewriteSystemPrompt`, `narrationToReviewText`, `extractNarrationText`; only
the *transport* is the harness's own (the bench reads these from `SOURCE_REF`).

The three candidate pipelines, all on `callGeminiRaw`:

- **gemini (single-pass)** — `callGeminiRaw` with B-stripped `SYSTEM_PROMPT` and
  `narrationSchema`; validate with `narrationSchema.parse(JSON.parse(...))`.
- **gemini-critique**:
  - **draft** — same as single-pass (B-stripped system, schema).
  - **critique** — `callGeminiRaw` with A-stripped `CRITIQUE_SYSTEM_PROMPT`,
    `schema: null`, user message = `narrationToReviewText(draft)`. Output is
    guidance text.
  - **rewrite** — `callGeminiRaw` with `buildRewriteSystemPrompt(critique)` built
    on the **B-stripped** `SYSTEM_PROMPT` (the function embeds `SYSTEM_PROMPT`
    verbatim, so the bench calls a B-stripped variant of it), schema on. The
    rewrite reuses the **same composed `userMessage`** as the draft —
    `buildUserMessage(facts, recentProse, steer)`, i.e. facts plus the
    `recentProse` avoid-block, not a bare facts re-derivation. Fact-invention is
    guarded by `assertIdSubset`, not by the shape of the message.

Mirrors `polishedNarration`'s shape: an **empty or whitespace-only** critique
ships the draft (no rewrite call). A non-empty critique is injected verbatim — the
bench does NOT validate critique content (matches production; a garbage critique
just steers phrasing and the rewrite is still schema-validated). A
critique-or-rewrite **failure** ships the validated draft (polish never blocks).
The draft and rewrite are id-checked inside the critique pipeline: a draft that
invents an id fails the candidate, but a **rewrite** that invents an id degrades
to shipping the id-clean draft (`polished:false`) rather than failing the
candidate. Only a **draft** failure (throw or id-subset violation) fails that
candidate.

## Failure policy, resume, rate limits

- **Per-day incremental write.** Each day's markdown is written **as soon as that
  day finishes**, so a failure on a later day preserves earlier days' output. The
  run is restartable: re-running regenerates from scratch (Gemini is
  non-deterministic; no cell cache — this is a ~16-call one-off, not the 48-call
  bench).
- **Candidate failure is contained.** If a candidate throws after its retries
  (e.g. terminal 429 / daily-quota wall that 20-60-120s backoff can't clear), the
  harness records `*** FAILED: <reason> ***` in that candidate's slot and
  continues — a missing candidate never blocks the rest of the day or run.
- **Day gate failure** (hash mismatch, missing day file, unparseable JSON) skips
  that day with a logged reason and continues the others.
- **Exit code.** The process exits **0** if it produced any output, but prints a
  final summary line listing skipped days and failed candidates. It exits **1**
  only if it produced *no* output at all (e.g. `GEMINI_API_KEY` missing, or every
  day failed) — so a partial run is inspectable, a total failure is loud.
- **Wall-clock.** ~16 calls, sequential, ≥1s spacing between calls. Worst case a
  rate-limited key stacks `narrate`-style backoff (20+60+120s) per call; the
  harness logs each backoff so a long run is visible, and a daily-quota 429 fails
  the candidate fast rather than looping.

## Output: labeled markdown dump

The runner writes one markdown file per day under
`.artifacts/main/bench-2026-06-15/<date>.md` and an `INDEX.md`. The user reads and
decides — no scoring code, no picks file (that is a follow-up if wanted).

Per-day file shape (candidates labeled, not blind — user's choice):

    # 2026-06-12  (source: origin/main · 2 matches · no stats · no hash gate)
    model: gemini-3-flash-preview

    ## existing  (narrator: gemini)
    HEADLINE: ...
    SUMMARY: ...
    PILL <id> [drama] Home–Away: ...
    TONIGHT Home–Away | <alarm> | <why>

    ## gemini  (current prompt, B-stripped)
    ...

    ## gemini-critique  (B-stripped draft/rewrite, A-stripped critique)
    ...

    # (Jun 15 only) adds, after the three above:
    ## opus-history (b801c50)
    ...

The output dir is created with `mkdir -p` at start. `INDEX.md` lists the days,
the `SOURCE_REF` and Gemini model id used, and per-day notes (match count, whether
stats/hash-gate were present, the Opus-history shas for Jun 15, and any
skipped-day / failed-candidate reasons).

## Cost / execution

- Gemini free-tier only. Roughly 4 single-pass + 4×3 critique = ~16 Gemini calls.
- Calls run **sequentially with ≥1s spacing** to dodge per-minute 429s.
- **Zero Opus calls** — the Opus column is read verbatim from `SOURCE_REF`.
- **`GEMINI_API_KEY` load:** the harness loads `.env` itself (production loads it
  in `run.js`, not in `narrate.js`; this script doesn't go through `run.js`), then
  reads `process.env.GEMINI_API_KEY`. Missing/empty key → exit 1 before any call.

## Code location

- `scripts/bench-gemini.js` — one standalone file, matching the existing
  `scripts/check-*.js` one-off-tool convention.
- It **imports prompt/schema/builder helpers** from `pipeline/narration-core.js`
  and `pipeline/facts-hash.js` (resolved at run time; the script reads the
  `SOURCE_REF` versions of the prompts via `git show`, not the local working-tree
  versions, so a dirty tree doesn't skew the bench). It **owns its Gemini
  transport** (`callGeminiRaw`) and the A/B-strip string edits — these are bench
  artifacts, not production code. `narrate.js` is **not** used (no custom-prompt
  hook). `recentProseBefore` is reimplemented (~15 lines) against `SOURCE_REF`.

## Verification

This harness produces prose for a human to judge; its own correctness is provable
without judging the prose. A small `test/bench-gemini.test.js` covers the
pure-function pieces (no network):

1. **Fact reconstruction round-trips** — given a fixture day file, the
   reconstructed `{date, finished, tonight}` recomputes to the stored `factsHash`.
   Covers Jun 14/15 shape. (What the gate proves and does NOT prove — stats /
   standings excluded — is documented above, not claimed here.)
2. **A/B strips hit their targets** — applying the B-strip regex to the real
   `SYSTEM_PROMPT` removes the named-calque seed and leaves the restraint rule;
   applying the A-strip to `CRITIQUE_SYSTEM_PROMPT` removes the two named calques
   + portar bullet and leaves `„un cap de X"` / the structural example. A strip
   whose target is absent **throws** (drift guard).
3. **No fact invention** — every regenerated candidate's match/tonight ids are a
   subset of the input ids; the script asserts this on each regenerated narration
   (the merge that guarantees it in production is NOT run here, so the assertion
   is the harness's own). Opus-history candidates are **exempt** (historical
   output, rendered verbatim).
4. **Renders** — the markdown renders for all selected days; each present
   candidate shows the four fields, each failed candidate shows a FAILED marker.

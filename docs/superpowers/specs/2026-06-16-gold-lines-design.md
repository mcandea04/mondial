# Gold-line compounding loop — design

Date: 2026-06-16

## Problem

The commentary should be sharp and witty — something the owner would actually say to
his friends about the games. Two things block that today:

1. **The prompt only teaches by negation.** `narration-core.js` carries ~100 lines of
   "don't" (banned portal-speak, no calques, hide the FIFA rank) plus a per-run "avoid
   these recent lines" block. It has never shown the model a single line the owner thinks
   is funny. Rules prune the bad; they do not pull toward the good.
2. **Course-corrections don't compound.** The owner can already re-narrate a day via an
   email link (`re-narrate.yml`), but steering is one-shot: it fixes today and evaporates.
   Each morning starts from the same flat prompt, so quality does not climb with effort —
   and in fact 2026-06-16 regressed against 2026-06-14 (see below).

The benchmark harness built earlier (Gemini vs Claude, LLM judge) is the wrong tool for
this: "witty" has no gradient an automated judge can climb, and the judge lacks the only
ground truth that matters — the owner's taste. It is retained, if at all, only as a cheap
regression check (banned clichés absent, headline ≤70 chars, ≤1 exclamation mark).

## Core idea

Give the prompt the positive mirror of the block it already has. A small, hand-blessed set
of **gold lines** — real lines the owner loved — is injected as few-shot taste examples on
every run. Rules stay flat forever; gold accumulates one morning at a time. That is the
"better with every intervention" the owner wants: each promotion permanently teaches the
voice instead of fixing a single day.

Gold teaches **rhythm, bite, and level of concreteness — never content.** This is the same
discipline as the existing avoid-list, opposite sign. The injected instruction must make
clear the examples are from other matches and must not be lifted into today's facts.

**Fact-leak risk (accepted, with mitigations).** Gold is the first place in the system where
free text containing real team names and numbers ("Elveția", "26 de ori", "Haiti") is fed to
the model with no structural guard — elsewhere facts merge back by match `id` in `run.js` and
the model literally cannot originate a score, but `headline`/`summary`/`pill` prose is taken
verbatim, so a leaked name in those fields has no downstream catch. We accept this rather than
build a prose-vs-facts validator (impossible for free text). Mitigations: (a) the injection
block fences the examples as "FROM OTHER DAYS" and explicitly forbids borrowing names/numbers;
(b) the seed session **prefers rewrites over verbatim keeps** — reworded lines carry the
owner's generic voice, not a sticky proper noun, lowering leak odds; (c) the owner reads the
morning email and can re-narrate if a name leaks. Residual risk documented, not engineered away.

## Components

### 1. Storage — `pipeline/gold.json` (committed)

A flat array of field-typed lines. Committed to git: it is the archive of the owner's taste.

    [
      { "field": "headline", "text": "Cum tragi de 26 de ori și nu câștigi? Întreabă Elveția" },
      { "field": "pill",     "text": "Haiti a tras de 15 ori și a nimerit poarta de două ori — a asaltat fără folos." },
      { "field": "tonight",  "text": "Olanda contra Japoniei la 23:00, două echipe care abia intră și chiar au cu ce." }
    ]

- `field` is one of `headline`, `summary`, `pill`, `tonight` — the four schema text fields,
  treated **uniformly** (the `tonight` gold field is a flattened `tonight[].why` sentence;
  `pill` is a `matches[].pill`). All four are seedable, promotable, and injected.
- A rolling cap per field (default 12) keeps the prompt bounded. The cap is enforced **both
  at append time and at load time** (`loadGold` trims each field to the cap on read), so a
  seed write or a hand-edit that overshoots is also bounded — the "always bounded" guarantee
  holds regardless of how the file got large. On overflow the oldest entry for that field is
  dropped (FIFO). The owner can hand-edit the file to curate.
- The file is seeded via the **interactive seed session** (below) so the loop starts warm
  and in the owner's voice, not empty and not in the agent's taste.

### 1a. Seed session (interactive, owner-driven) — an implementation step

Before the loop goes live, `gold.json` is populated by walking the existing digests
(`site/data/*.json`) line by line. The agent prints each candidate line for all four fields
— `headline`, `summary`, each `pill`, each `tonight.why` — one digest at a time. For each,
the owner says
**keep** (line enters gold verbatim), **rewrite** (owner gives his own wording; the rewrite
enters gold — the most valuable kind of gold, his exact voice), or **skip**. The agent
writes the accumulated entries to `gold.json` at the end, field-typed.

This is a dedicated, gated step in the implementation plan — not automated, not the agent
choosing. It is the truest seed: real lines, judged and reworded by the only judge that
matters. The same keep/rewrite/skip gesture is what the email-link promotion does later,
one line at a time; the seed session is just the batch version run once at the start.

### 2. Injection — one new block in `buildUserMessage` (`narration-core.js`)

`buildUserMessage` gains an optional `gold` argument (array of `{field, text}`). When
present and non-empty it appends a block, grouped by field, of the form:

> EXEMPLE DE TON REUȘIT — așa sună o frază bună din ALTE zile (ritm, înțepătură, concret).
> NU copia conținutul și nu împrumuta numele/cifrele din ele — sunt din alte meciuri.
> Potrivește ACEST nivel de umor și de precizie la faptele de AZI.

Grouped by field as `HEADLINE: …`, `SUMMARY: …`, `PILL: …`, `TONIGHT: …` so a gold pill
teaches pills, etc. (all four schema fields, summary included). The block is purely additive;
when `gold` is empty the message is byte-identical to today.

### 3. Promotion — reuse the email + issue channel

The digest email already carries a re-narrate link. Add a second link next to it:

> Ți-a plăcut o frază? Salveaz-o pentru data viitoare: <issues/new?title=gold&labels=gold&body=…>

Body convention: one line per gold entry. Each line may start with a field prefix — and a
prefix counts **only** when it is exactly `headline:` / `summary:` / `pill:` / `tonight:`
(case-insensitive). Any other leading token before a colon is **not** a prefix: the whole
line is kept as `pill` text. This is what lets a real line containing a clock time survive
("Olanda contra Japoniei la 23:00 …" stores intact, not truncated at "23"). The owner pastes
the line he loved or **rewrites one in his own words** (a rewrite is the most valuable gold —
it is literally his voice, and least likely to leak a proper noun). The placeholder body
shown in the issue explains this in Romanian.

**One self-contained job, no second dispatch.** The doubt pass showed that the original
"append → push → dispatch a separate `digest.yml`" design has a propagation race (the
dispatched run checks out before the gold commit lands), a cross-workflow push collision, and
an orphaned-issue failure mode. The fix is to do everything in **one job** in `re-narrate.yml`,
gated on `label == 'gold'` and `user == owner`:

1. `actions/checkout` the repo (the existing trigger job has none — this is new).
2. Parse the issue body into `{field, text}` entries (strip the HTML-comment placeholder,
   ignore blank lines), **append with dedup**: an entry whose `{field, text}` already exists
   is skipped, so re-filing the same line is a no-op (this replaces the previous
   "dedup out of scope" line — dedup is now required, it is what makes the job idempotent).
   Apply the per-field FIFO cap. Write `gold.json`.
3. Re-narrate today **in the same job**: `node pipeline/run.js --re-narrate`, with `gold.json`
   already on disk so the fresh prose sees the new gold immediately — no second workflow, no
   propagation race.
4. `git add gold.json site/data site/index.html`, `git pull --rebase origin main`, commit,
   push — the commit+rebase block ported from `digest.yml`. One push, after rebase.
5. Email the owner (see below), then comment + close the issue (Romanian confirmation).

The job needs `permissions: contents: write` (the current workflow has only `issues`/`actions`)
and must join `concurrency: { group: digest }` so it serialises against the nightly digest run
and never races its push. The repo must have a `gold` label for the URL's `labels=gold` to
apply; creating it is a setup step.

Parsing and file I/O live in a small committed script (`pipeline/gold.js`), not inline shell —
the issue body travels via env, never interpolated into `run:` (shell-injection rule, already
noted in `re-narrate.yml`). `gold.js` exposes:

- `loadGold(path)` → array, FIFO-capped per field on read (missing file → `[]`; **malformed
  JSON → throw, never silently return `[]`** so a corrupt file can't be overwritten and erase
  the curated archive — the run-time narrator path catches the throw and proceeds gold-less,
  the append path aborts).
- `parseGoldIssue(body)` → `[{field, text}]`, applying the exact-prefix rule above; empty/
  placeholder-only body → `[]`.
- `appendGold(existing, entries, cap)` → new array, dedup then per-field FIFO cap.
- a thin CLI (`node pipeline/gold.js add-from-issue`) reading the body from an env var and
  writing the file, so the workflow stays a one-liner and the logic is unit-tested.

**Email on re-narrate even when prose is unchanged.** `digest.yml` only emails when the commit
step actually committed; if the new gold doesn't change the output the owner would get silence.
The re-narrate-triggered path must email regardless, with a body noting "regenerat, proza
neschimbată" when nothing changed, so the confirmation promise holds. (Applies to the existing
re-narrate flow too.)

### 4. Wiring in `run.js` and the polish path

`run.js` loads `gold.json` once (best-effort; missing/empty/throws → no block) and threads it
through **every** narrator path into `buildUserMessage` alongside `recentProse` and `steer`:
the gemini single-pass, the gemini-polish draft, the `gemini-fallback` path, and the Claude
path. Missing one call site silently makes gold engine-dependent, so the plan enumerates all
four and a test asserts the block reaches the message on each.

**Gold reaches the rewrite, not just the draft.** Under `gemini-polish` (the production
default) the shipped prose comes from the **rewrite** call, whose system prompt
(`buildRewriteSystemPrompt`) tells the model to preserve the draft's tone and change only
flagged idioms. If gold only influenced the draft, the rewrite's "keep what you wrote"
instruction would half-overwrite gold's pull exactly where it ships. Fix: add one line to
`buildRewriteSystemPrompt` reminding it the gold examples still set the target level. Gold
already rides the rewrite's user message (it reuses the original `userMessage`); this makes
the system prompt agree.

**Gold subtracted from the avoid-list.** A promoted line is, by definition, a line that
appeared in a recent digest — so it can land in *both* the gold block ("imitate this") and the
`recentProseBefore` avoid-list ("do NOT reuse this"), a contradiction. `run.js` filters gold
texts out of `recentProse` before building the message, so a blessed line is taught, not
forbidden.

The freeze path is unchanged: when facts are unchanged `run.js` reuses stored prose and skips
narration entirely, so newly promoted gold has no effect on a frozen day — that is correct,
because promotion always re-narrates (`--re-narrate`) which bypasses the freeze. Documented so
a plain run on an unchanged day showing "no gold effect" is not mistaken for a bug.

### 5. Regression fix (folded in)

2026-06-16's `tonight` lines went anonymous — the "hide the FIFA rank number" rule
overcorrected and the model dropped the team names too:

- 2026-06-14: "Olanda contra Japoniei la 23:00, două echipe care abia intră în turneu…"
- 2026-06-16: "E la o oră decentă, un meci între două forțe care se bat pe primul loc."

Tighten rule 5 / the rank-as-tool note in `SYSTEM_PROMPT`: hide the rank **number**, never
the teams — every `why` must name who plays. Verify by re-narrating 2026-06-16 and eyeing
that each tonight line names both teams while still not printing "locul N".

## Data flow

    gold.json ─┐  (gold texts subtracted from recentProse)
    facts ─────┼─> buildUserMessage ─> draft ─(polish: gold in rewrite too)─> narration ─> run.js merges facts ─> site/data
    recentProse┤
    steer ─────┘

    email "salveaz-o" link ─> issue(label=gold) ─> re-narrate.yml gold job (one job, concurrency: digest)
        ─> gold.js parse+dedup+cap ─> write gold.json ─> run.js --re-narrate ─> rebase+commit+push ─> email

## Error handling

- Missing or empty `gold.json` → no gold block, run proceeds normally (the loop is an
  enhancement, never a hard dependency).
- **Malformed `gold.json` → `loadGold` throws.** The narrator path catches it and proceeds
  gold-less; the append path aborts rather than overwrite, so a corrupt or half-edited file
  never erases the curated archive.
- Empty issue body / only the placeholder comment → `parseGoldIssue` returns `[]`; the job
  appends nothing but still re-narrates today (no new gold, but the gesture still refreshes)
  and says so in the issue comment and the email.
- Re-filing an already-promoted line → dedup makes it a no-op, so a retried or duplicated
  issue is harmless.
- The per-field FIFO cap, enforced at both append and load, bounds the number of lines; gold
  text length is not separately capped — acceptable at this scale, revisit only if prompts
  bloat.

## Testing

- `gold.js` unit tests: `parseGoldIssue` (exact-prefix only; bare line → pill; a line with a
  clock time / stray colon stays whole as pill; placeholder/blank stripping; empty → `[]`),
  `appendGold` (dedup, FIFO cap per field, mixed fields), `loadGold` (missing → `[]`,
  malformed → throws, over-cap file trimmed on read).
- `buildUserMessage` test: gold present → block appears, grouped by all four fields, with the
  "from other days, don't copy content" framing; gold empty → message byte-identical.
- `buildRewriteSystemPrompt` test: the gold-target reminder line is present.
- `run.js` test: gold subtracted from `recentProse` (a line in both inputs appears only in the
  gold block, not the avoid-list); gold reaches the message on all four narrator paths.
- Offline pipeline run (`--fixtures`, **without** `narration.json` so the user message is
  actually built) with the owner-seeded `gold.json` confirms the block reaches the model
  message and nothing else regresses.
- Scenario proof (the real test): dispatch `digest.yml` force=true to re-narrate 2026-06-16
  and judge by eye — tonight lines name teams (regression fixed) and pills carry more bite.
- **Polish-keep A/B (decision step, not a removal):** the critique→rewrite pass
  (`gemini-polish`) catches idiom calques on *today's* novel sentences — a job gold few-shot
  cannot do, since gold is about other matches. It was already scoped to language-only
  because a generic voice critique flattened the punch (`narration-core.js:184`). Gold does
  not replace it. Once gold is seeded, re-narrate the same day twice — once with
  `NARRATOR=gemini-polish` (gold + critique), once with `NARRATOR=gemini` (gold only) — and
  compare by eye. Keep the polish pass unless gold-only is demonstrably as idiomatic; only
  then drop it, with evidence. Default for this work: polish stays.

## Out of scope (YAGNI)

- No automated scoring of gold candidates — the owner is the judge.
- No per-field weighting or recency decay (exact-text dedup IS in scope — it is what makes the
  promotion job idempotent).
- No prose-vs-facts validator for leaked names — accepted risk, mitigated by framing, rewrite
  preference, and the owner's morning read (see Core idea).
- No UI; promotion is the email link only.
- The benchmark harness is not extended; at most kept as a mechanical regression check.

## Setup items (one-time, in the plan)

- Create the `gold` label in the repo so the email link's `labels=gold` applies.
- Seed `gold.json` via the interactive seed session before first deploy.

# Natural Romanian + stat restraint in the narration prompt

**Date:** 2026-06-14
**Status:** Approved. Amended twice after spec-doubt: (1) reframed A/B from human
to autonomous judge; (2) cut the automated A/B harness entirely after plan-doubt
found its acceptance gate unwinnable — replaced with a manual old-vs-new prose
check on today's facts.

## Problem

The deployed digest shows three distinct defects in the prose.

1. **Calque Romanian.** Phrases read like word-for-word translations from English:
   - `posesia n-a plătit nimic` (calc of "possession didn't pay off")
   - `victorie limpede` (calc of "clear win")
   - `portarul australian a scos de opt ori` (elliptic — "scos" wants an object)

2. **Stats skew + body-part spam.** Since the `feat: richer match facts` change
   (commit `2ea3151`) the model has possession/shots/saves and per-goal
   `bodyPart`/`placement`/`assist`. It now over-uses them. Body part especially:
   left-or-right foot is almost never interesting, yet appears on nearly every
   goal —
   > cu dreptul din afara careului, la pasa lui Brahim Díaz. Vinícius a egalat în
   > minutul 32, tot cu dreptul, din stânga careului.

   Two goals in one breath, both "cu dreptul". The detail adds nothing and the
   prose drowns in it.

3. **Dead label.** Each match card prints a fixed heading `Pastila de consecințe`
   above the pill text. The user wants it gone.

The first two are prompt-quality problems and cannot be proven fixed by a unit
test — they need blind human judgement on real prose. The third is a one-line
view change.

## Core principle (unchanged, load-bearing)

**Code establishes facts, the model writes the drama.** Nothing in this change
gives narration authority over a fact. Body part, placement, assist, and stats
stay facts computed in `pipeline/enrich.js` and merged by id. This change only
tells the model *when a fact is worth saying* and *how to say it in Romanian* —
restraint and idiom, never invention. A goal's `bodyPart` is still a fact; the
model simply earns the right to omit it (it already may — the prompt says "ce
lipsește, treci sub tăcere").

## Scope

In scope:

1. **`SYSTEM_PROMPT` (`pipeline/narration-core.js`)** — add restraint rules for
   body part and stats; replace the calque-shaped example templates.
2. **`CRITIQUE_SYSTEM_PROMPT` (`pipeline/narration-core.js`)** — add the three
   observed offenders as named calques the idiom reviewer must catch.
3. **`site/assets/render.js` + `site/assets/style.css`** — remove the `Pastila de
   consecințe` label `<p>` and its dead CSS rule, keep the pill text.
4. **Manual prose proof** — generate today's narration old-vs-new and check the
   three defects by eye (no automated judge; see "Proving the prompt changes").

Out of scope:

- Any automated A/B / LLM-judge harness — cut after spec-doubt (unwinnable gate,
  YAGNI scaffolding). A standing prose benchmark is a separate follow-up ticket.
- Changing the model, the schema, or the draft→critique→rewrite pipeline shape.
- Touching how `bodyPart`/`stats` are parsed or stored — they keep flowing into
  `site/data/<date>.json` untouched; only the prose's *use* of them changes.
- `mockup.html` label removal — it is a static design artifact, not served. Drop
  the label there too for consistency, but it is not load-bearing.

## Change 1 — body-part restraint (`SYSTEM_PROMPT`)

The current goal-detail block (lines ~50-55) lists `bodyPart` as one detail among
equals and says "țese-le natural în frază". It gives no weight order and no cap,
so the model treats every foot as quotable.

Add an explicit interest ranking and a hard cap. The cap is on the **foot**
specifically, not on "body part" as a category (resolves ambiguity A3 — a
header-vs-foot confusion in the original wording):

- The **foot** (`cu dreptul` / `cu stângul`) is **the least interesting detail**
  and is mentioned **at most once per match**, and only when the foot itself is
  the story — a screamer with the weak foot, a curler from distance. For a header,
  penalty, tap-in, or any ordinary goal, the foot is noise: omit it.
- `cu capul` (header) is **exempt from the foot cap** and stays freely usable — it
  changes the *image* of the goal, unlike left/right foot. Two headers in a match
  may both say `cu capul`.
- Placement, assist, penalty, own-goal remain freely usable when present; they
  carry real information.

The prompt text must say "the foot" (piciorul / cu dreptul-cu stângul), never
"body part", so the model never suppresses a second header to stay under a count.
Wording must stay in the existing Romanian register and fit the section's voice.

## Change 2 — stat restraint (`SYSTEM_PROMPT`)

The current stats block (lines ~56-60) already says "nu înșiri cifre seci" and
"alegi una care spune ceva", but offers `"a tras de N ori și n-a marcat"` as a
model template — which is itself the calque seed behind `posesia n-a plătit
nimic`. Tighten to:

- Stats are a **last-resort** angle, used at most **once across the whole match's
  prose** (its pill — and if the same match is the subject of the summary, the
  summary counts too: the stat appears once, not in both). Resolves ambiguity A2:
  the cap is "once per match-subject", and since `headline`/`summary` are
  digest-level the prompt phrases it as "for a given match, cite at most one stat,
  whether in the summary or its pill — never the same number twice."
- Use a stat **only** when a number contradicts the result (dominant team that
  lost or drew, a keeper who single-handedly saved a point). When the scoreline
  already tells the story, no stat.
- Drop the `"a tras de N ori și n-a marcat"` example. Replace it with a concrete
  native idiom — **reuse the Change-3 vetted phrasing** so SYSTEM_PROMPT and
  CRITIQUE_SYSTEM_PROMPT agree (resolves ambiguity A4): e.g. `degeaba a ținut
  mingea, că tot acasă a plecat` or `posesia n-a contat`. The example shapes
  output, so it must model the target register, not the defect.

## Change 3 — name the offenders in `CRITIQUE_SYSTEM_PROMPT`

The idiom critique already lists generic calques but missed these three live. Add
them to the bulleted calque list, each with the natural Romanian:

- `posesia n-a plătit / n-a plătit nimic` → `degeaba a ținut mingea` /
  `posesia n-a contat`
- `victorie limpede` → `victorie fără emoții` / `a câștigat fără să tremure`
- `a scos de N ori` (elliptic) → `a avut N intervenții` / `a scos N mingi`

`buildRewriteSystemPrompt` already feeds the critique into the rewrite, so naming
them here propagates to the rewrite with no further change.

## Change 4 — remove the pill label (`site/assets/render.js`)

`render.js:93` builds the pill with a label `<p>` and a text `<p>`. Remove the
label line; keep `pill-text`. The `.pill-label` CSS rule then becomes dead — it
lives in **`site/assets/style.css`** (the served stylesheet) and in `mockup.html`'s
inline `<style>`. **Drop the dead rule** in both (DRY: no orphan CSS). Mirror the
label removal in `mockup.html` too — it has the label in **two** places
(`mockup.html:229` and `:250`); remove both. The `mockup.html` change is for
consistency only and is not verified by a scenario.

This needs a Playwright scenario check (renders a real digest, asserts the string
`Pastila de consecințe` is absent and the pill text still shows) — per the task
completion protocol, the view change is proven in the browser, not just by eye.

## Proving the prompt changes (manual old-vs-new on today's facts)

### Why not an automated judge

An earlier draft of this spec specified an autonomous LLM-judge A/B harness
(`bench-prompt/`). A spec-doubt panel rejected it: an LLM blind-judging two
good-but-different prose variants is near a coin-flip, so a "candidate must win
both stress days in both orderings" gate is not reliably winnable — noise alone
can block merge forever. It also added ~850 lines of scaffolding (frozen prompts,
synthetic fact-days, dual-order judge, verdict caching) whose every part carried a
soundness finding, while the actual product change — four prompt/view edits — is
small and well-grounded. That harness is **cut** (YAGNI). If a standing prose
benchmark is ever wanted, the existing human-judged `bench/` is the better base; a
follow-up ticket tracks it.

### What proves these changes instead

The three defects are concrete and observable on **one set of facts that matters:
today's (2026-06-14)**, which carries real `bodyPart`/`placement`/`assist`/`stats`
in `site/data/2026-06-14.json`. The proof is a direct old-vs-new comparison, done
once, by eye:

1. With the prompt edits in place, generate narration for today's facts **twice**:
   once with `git stash`/`git show main:` baseline prompts, once with the new ones.
   Easiest path: run `node pipeline/run.js --fixtures <today> --date 2026-06-14`
   (offline, no football-data call) against the committed facts, or
   `--re-narrate --date 2026-06-14` live, on the branch before and after the edit.
2. Put the two outputs side by side and check the three defects **directly** (no
   judge, no scoring):
   - **Foot spam gone** — the new prose does not repeat `cu dreptul` / `cu stângul`
     within a match (at most one foot mention, header `cu capul` exempt).
   - **Calques gone** — no `posesia n-a plătit nimic`, `victorie limpede`, or
     elliptic `a scos de N ori`; reads like the natural-idiom targets.
   - **Stats restrained** — at most one stat angle per match-subject, only when a
     number contradicts the result.
   - **Voice intact** — the punch and humor survive (guard against the
     `opus-polish` flattening trap); if the new prose is blander, the wording went
     too far — iterate.
3. Save both outputs under `.artifacts/main/prompt-ab/` (`baseline.json`,
   `candidate.json`) and attach the side-by-side to the PR as the evidence.

This doubles as the closing redeploy step: the `candidate` generation on today's
facts is exactly what ships (see "Redeploy" below).

## Files touched

- `pipeline/narration-core.js` — `SYSTEM_PROMPT` (Changes 1-2),
  `CRITIQUE_SYSTEM_PROMPT` (Change 3). Both ship to prod (`NARRATOR=opus-polish`).
- `site/assets/render.js` — remove pill label `<p>`.
- `site/assets/style.css` — drop dead `.pill-label` rule.
- `mockup.html` — remove both pill-label occurrences + inline `.pill-label` rule
  (cosmetic mirror, unverified).

No new harness files, no `bench-prompt/`.

## Verification

- **Unit:** existing `narrate.test.js` / `narration-polish.test.js` stay green
  (prompt wording is not asserted; schema/flow unchanged). Run `npm test`.
- **Scenario (browser):** Playwright loads a built digest, asserts `Pastila de
  consecințe` absent, pill text present.
- **Prose (the real proof):** the manual old-vs-new comparison above —
  `baseline.json` vs `candidate.json` on today's facts, three defects checked by
  eye, attached to the PR.

## Redeploy + redo today's digest (closing step, post-merge)

The user's instruction: after merge, redeploy and re-narrate today (2026-06-14).
Order is load-bearing — `digest.yml` checks out the **default branch**, so the new
prompts must be on `main` first or re-narration uses the old prompts.

1. **Merge first.** Squash-merge the feature branch into `main` (per repo
   convention) so `pipeline/narration-core.js` carries the new prompts.
2. **Re-narrate on main with the new prompts.** From a clean `main` checkout, with
   `FOOTBALL_DATA_TOKEN`, `GEMINI_API_KEY`, and `NARRATOR=opus-polish` in env:

       node pipeline/run.js --re-narrate --date 2026-06-14

   `--re-narrate` (run.js:334) bypasses the facts-hash freeze and regenerates
   `site/data/2026-06-14.json` + `latest.json`. **This overwrites today's committed
   prose with fresh, non-deterministic output — there is no automatic backup, so
   stash a copy of `site/data/2026-06-14.json` first** in case the new prose needs
   comparing or reverting. On failure `run.js` leaves `latest.json` untouched and
   exits non-zero (safe — no half-write ships).
3. **Commit + push + deploy.** Commit the regenerated `site/data/2026-06-14.json`,
   `latest.json`, `manifest.json`, and `og/2026-06-14.png`, push to `main`, then
   trigger the Pages deploy (`deploy.yml` `workflow_dispatch`, which deploys
   committed `site/` without re-running the pipeline). Verify the live page shows
   the new prose and no `Pastila de consecințe` label.

If local re-narration can't run (no `claude`/Bedrock, or missing tokens), fall
back to `digest.yml` `workflow_dispatch` with `force=true` **after** the merge —
it runs `node pipeline/run.js --re-narrate` in CI with `NARRATOR=opus-polish` and
deploys in the same run.

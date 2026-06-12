# Facts-hash freeze for published digests

Date: 2026-06-12
Status: approved

## Problem

Every pipeline run calls Gemini and overwrites `site/data/<date>.json`, `latest.json`, the OG image, and the OG tags in `index.html`. Narration is non-deterministic, so a forced workflow re-run after a code fix (or a local test run) replaces the prose that was already published and emailed in the morning with new, usually blander prose. Two leak paths:

1. Forced workflow re-run (`workflow_dispatch` with `force=true`) re-narrates the same date and commits the result.
2. Local and test runs write into the real `site/data/` directory, even in fixtures mode.

## Decision

Prose follows facts. A published digest is reused as long as the underlying facts have not changed. When facts change (the API corrected a score, a late match got added), the prose that narrates them is stale anyway, so the digest is re-narrated automatically. A manual flag covers the remaining case (facts fine, prose bad).

## Design

### 1. Facts hash

- Compute a canonical JSON serialization of the narration input `{date, finished, tonight, standings}`:
  - object keys sorted recursively,
  - `finished` and `tonight` arrays sorted by match id,
  - standings sorted by group name.
- Hash it with SHA-256.
- Store the hash as a `factsHash` field in `site/data/<date>.json`.

### 2. Run flow (`pipeline/run.js`)

On every run: gather facts, compute the hash, read the existing `<date>.json` if present.

- **Hash matches and `--re-narrate` not given:** reuse the stored prose (headline, summary, per-match pill/drama, per-fixture alarm/why). No Gemini call. Files are written only when the new bytes differ from what is on disk; the OG image is regenerated only when the file is missing. Log "facts unchanged, prose reused".
- **Hash differs:** facts changed, so re-narrate everything. Prose must match facts.
- **`--re-narrate` flag:** force the Gemini call even when the hash matches.

Reusing prose for tonight fixtures needs a stable key: add `id` to the stored `tonight` entries (additive field). For digest files written before this change, fall back to matching by `home` + `away`.

### 3. `latest.json` guard

Write `latest.json` only when the digest date is greater than or equal to the date inside the existing `latest.json`. A backfill run for an older date can no longer clobber today's page.

### 4. Test and local isolation

- New `--out <dir>` flag redirects all data writes (per-day JSON, `latest.json`, OG image, manifest) to the given directory.
- Fixtures mode defaults to `tmp/out/` when `--out` is not given.
- Live runs keep writing to `site/data/`.
- When `--out` is active, the `index.html` OG-tag mutation is skipped.

### 5. Workflow (`.github/workflows/digest.yml`)

- New `workflow_dispatch` boolean input `re_narrate`, passed to the pipeline as `--re-narrate`.
- A forced re-run after a code fix now hits the hash-match path, produces no content diff, and the existing `git diff --cached --quiet` check skips the commit. The deploy steps still run, so code changes to the site still ship.

### 6. Remote re-narration from the phone (issue trigger + steering note)

For the case "facts are fine, prose is bad, laptop is far away":

- The daily digest email gets one extra line: a prefilled new-issue link,
  `https://github.com/mcandea04/mondial/issues/new?title=re-narrate&labels=re-narrate&body=<url-encoded placeholder>`.
  The body placeholder hints that free text typed there becomes a steering note, e.g. "(optional: scrie ce vrei schimbat la ton/glume)".
- A new workflow triggers on `issues: opened`. It runs only when the issue has the `re-narrate` label **and** the issue author is the repo owner (`mcandea04`); anything else exits without side effects. The `re-narrate` label must be created in the repo once.
- The issue workflow is a thin trigger, not a second build pipeline: it dispatches the existing digest workflow via `gh workflow run` with `force=true`, `re_narrate=true`, and `steer=<issue body>`, then comments on the issue that regeneration started (with a link to the Actions run) and closes it. The digest workflow's existing email step is the confirmation: a fresh email arrives with the new headline.
- `digest.yml` gains a second `workflow_dispatch` input `steer` (optional string) next to `re_narrate`, both forwarded to the pipeline.
- The pipeline gains a `--steer <text>` flag. `narrate()` appends the text to the prompt as a one-shot instruction for this regeneration only. The note is not stored in the digest file; the closed issue is the history of when and why prose was regenerated.
- Injection safety: the issue body is passed to the workflow step through an `env:` variable, never interpolated directly into a `run:` script (`${{ github.event.issue.body }}` inside shell is a classic script-injection hole). The author check means only the owner can reach the Gemini call at all.
- Workflow permissions stay minimal: the issue workflow needs `issues: write` and `actions: write`, nothing more.

Phone flow end to end: tap link in the morning email, optionally type a steering note in the issue body, tap Submit. Two taps plus optional typing.

## Error handling

Unchanged from today: any failure leaves `site/data/` untouched and exits non-zero, so the workflow skips commit and deploy. An existing `<date>.json` that predates this change (no `factsHash` field) is trusted: its prose is reused and the newly computed hash is stamped in, so already-published days are protected from the first run of the new code. A corrupt or unparseable file is treated as "no existing digest": the run re-narrates and overwrites it.

## Testing

- Unit tests for canonical hashing: key order and array order do not change the hash; a changed score does.
- Pipeline run twice on the same fixtures: the second run makes no narration call and produces byte-identical output.
- `--out` isolation: a fixtures run leaves the real `site/data/` untouched.
- `latest.json` guard: a run for an older date does not overwrite a newer `latest.json`.
- `--steer` plumbing: the steering text ends up in the narration prompt; absent flag leaves the prompt unchanged.
- Issue-trigger workflow conditions (label + author) verified manually after deployment: an issue without the label and a simulated foreign author must both be no-ops.

## Verification plan (acceptance scenarios)

Layered so the published page is touched only once, at the end:

1. **Offline, no Gemini:** fixtures plus `--out` — hash reuse on second run, no narration call, byte-identical output, `--steer` text present in the built prompt.
2. **Live Gemini, no publish:** local run for the real date with `--re-narrate --steer "..." --out tmp/` — inspect the regenerated, steered prose in the tmp file. Proves steering quality end to end without deploying.
3. **Full remote E2E, once:** open the prefilled issue from the phone, watch the workflow re-narrate, deploy, and email the new headline. Then restore.

Restore recipe (verified against git history: every digest commit carries `<date>.json`, `latest.json`, the OG png, and `index.html` together, so one revert restores all prose):

    git revert <digest-commit> && git push
    gh workflow run digest.yml -f force=true

The forced run recomputes the facts hash, matches the restored file, reuses its prose, commits nothing, and redeploys the restored content to Pages. If today's prose feels too precious even for minutes, run scenario 3 against yesterday's date instead — the `latest.json` guard keeps today's page untouched and the archive day is restored the same way.

## Out of scope

- Quality comparison between old and new prose (keep-best strategies).
- Any change to the polling/readiness gate.
- Persisting steering notes or feeding them into future days' narration.

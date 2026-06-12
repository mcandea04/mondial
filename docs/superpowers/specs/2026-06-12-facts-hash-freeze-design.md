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

## Error handling

Unchanged from today: any failure leaves `site/data/` untouched and exits non-zero, so the workflow skips commit and deploy. An existing `<date>.json` that predates this change (no `factsHash` field) is trusted: its prose is reused and the newly computed hash is stamped in, so already-published days are protected from the first run of the new code. A corrupt or unparseable file is treated as "no existing digest": the run re-narrates and overwrites it.

## Testing

- Unit tests for canonical hashing: key order and array order do not change the hash; a changed score does.
- Pipeline run twice on the same fixtures: the second run makes no narration call and produces byte-identical output.
- `--out` isolation: a fixtures run leaves the real `site/data/` untouched.
- `latest.json` guard: a run for an older date does not overwrite a newer `latest.json`.

## Out of scope

- Quality comparison between old and new prose (keep-best strategies).
- Any change to the polling/readiness gate or the email step.

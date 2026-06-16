# SPEC — „Mondialul de dimineață" (World Cup morning digest)

A static website, rebuilt once per day, that tells a group of friends in Romania (EEST)
what happened overnight at the 2026 World Cup and what it means — in Romanian, at a glance.

## 1. Product summary

Every morning at ~07:30 EEST the site shows, for the previous night:

1. **Headline of the night** — one punchy Romanian headline + 2-sentence summary.
2. **Match cards** — one per game: final score, scorers with minutes, key events
   (red cards, penalties, notable VAR moments), and the **consequence pill**:
   2–3 sentences in Romanian explaining what the result means for qualification,
   plus a drama rating 1–5 (rendered as flame icons).
3. **Group snapshots** — mini standings tables for every group that played,
   with a status badge per team: `calificată` / `în cărți` / `are nevoie de minune` / `eliminată`.
4. **„La noapte — merită alarma?"** — tonight's fixtures converted to EEST, each with a
   watchability badge (`stai treaz` / `citești dimineața`) derived from computed stakes.
5. **WhatsApp teaser** — a 2–3 line share text (headline + match count + URL) and a
   share button. Rich preview via Open Graph tags + a freshly generated OG image.

Language: Romanian with correct diacritics (ă â î ș ț). Units/times: EEST (Europe/Bucharest).

## 2. Architecture

Static site + daily batch job. No server, no database.

```
GitHub Actions (cron 04:30 UTC = 07:30 EEST)
  └─ node pipeline/run.js
       1. fetch results, fixtures, standings  (ESPN public API)
       2. compute standings + qualification scenarios (deterministic, Phase 2)
       3. call Gemini API → headline, pills, drama ratings, teaser (strict JSON out)
       4. generate OG image (PNG) for the day
       5. write site/data/YYYY-MM-DD.json + site/data/latest.json
  └─ commit site/data/* → deploy site/ to GitHub Pages (same workflow run)
```

Key principle: **code establishes facts, Claude writes the drama.** The model must never
invent scores, scorers, standings, or qualification arithmetic — those arrive as verified
inputs. The model only converts them into voice.

## 3. Repo structure

```
mondial/
├── SPEC.md                      # this file
├── package.json                 # Node 20+, ESM
├── .github/workflows/digest.yml # scheduled pipeline + deploy
├── pipeline/
│   ├── run.js                   # orchestrator (steps 1–5 above)
│   ├── espn.js                  # ESPN client: results, fixtures, standings + scorer/card enrichment
│   ├── standings.js             # group tables + status classification
│   ├── scenarios.js             # Phase 2: deterministic qualification scenarios
│   ├── narrate.js               # Gemini API call, prompt template, JSON validation
│   ├── og-image.js              # daily OG image (satori + @resvg/resvg-js)
│   └── teaser.js                # WhatsApp share text assembly
├── site/
│   ├── index.html               # digest page (vanilla HTML/CSS/JS, mobile-first)
│   ├── arhiva.html              # archive: pick any past day
│   ├── assets/                  # css, flag icons, fonts
│   └── data/
│       ├── latest.json          # today's digest (what index.html loads)
│       ├── 2026-06-12.json …    # one file per day (archive for free, in git)
│       └── og/2026-06-12.png …  # daily OG images
└── test/
    ├── standings.test.js
    └── scenarios.test.js        # the only part that truly needs tests
```

## 4. Pipeline details

### 4.1 Fetch (`espn.js`)
- Source: ESPN's public soccer API, competition `fifa.world`
  (`site.api.espn.com/.../soccer/fifa.world`). No key, no auth, no season gate.
- Pull: yesterday's finished matches, today's & tomorrow's fixtures, current group
  standings. The `scoreboard` lists a date's events; each finished event's `summary`
  carries a `keyEvents` timeline (goals, cards) and a boxscore (team stats), reshaped
  into the `goals[]`/`bookings[]`/`stats` shape so `parseMatch` stays the single normalizer.
- "Yesterday" = the EEST night window: matches with UTC kickoff between
  `yesterday 16:00 UTC` and `today 06:00 UTC` (covers 19:00–09:00 EEST). Compute the
  window with `Intl`/`Temporal` against `Europe/Bucharest`, never hardcode offsets.
  ESPN dates its scoreboard by US/Eastern day, so a night can span two date-boards;
  both are queried.
- A match is "over" when ESPN reports `completed===true`. `isOver` is the single
  predicate behind both the readiness gate (`fetchNightMatches`) and the build
  (`fetchDigestData`), so the two always agree on the finished set.
- Unofficial/undocumented, so parsing keys off `keyEvents[].type.text` defensively and
  per-event enrichment is best-effort: a missing event summary leaves the match with
  score + pill only. A missing scorer never blocks a night from publishing.

### 4.2 Standings & status (`standings.js`)
- Recompute or ingest group tables; classify each team:
  - `calificată` — mathematically through (top-2 secured, or assured best-third in Phase 2)
  - `eliminată` — mathematically out
  - `are nevoie de minune` — alive only via unlikely combinations (needs results elsewhere)
  - `în cărți` — everything else
- 2026 format: 12 groups of 4; top 2 advance plus the 8 best third-placed teams.

### 4.3 Scenario engine (`scenarios.js`) — **Phase 2, ship before matchday 3**
- For each team still alive, enumerate remaining group permutations (small space:
  per group, ≤2 remaining matchdays × 3 outcomes per match) and emit verified facts like:
  - `Germania se califică sigur dacă: bate Spania ȘI Panama nu bate Honduras.`
  - `Japonia este calificată cu un egal.`
- Apply FIFA tiebreakers in order (points; goal difference; goals scored; head-to-head
  points/GD/goals among tied teams; fair-play points; drawing of lots) — **verify the
  exact order against the official FIFA 2026 regulations before implementing**, and
  encode the best-thirds ranking rules separately.
- Where outcome depends on lots/fair-play, output `scenariu incert (departajare specială)`
  rather than guessing.
- Output: array of plain-text scenario facts per team, fed verbatim to the model.
- This module gets real unit tests with handcrafted standings.

### 4.4 Narration (`narrate.js`)
- Gemini API (switched from Claude API: AI Studio free tier covers the one
  call per day with no billing), `POST
  https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`.
  Model: `gemini-2.5-flash` — `gemini-2.5-pro` has no free-tier quota
  (swap via env var `GEMINI_MODEL`). Structured output
  (`responseMimeType` + `responseSchema`) enforces the JSON schema server-side.
- One call per day (all matches in one request) keeps context coherent across the night.
- Input payload (user message): structured JSON with, per match: teams, score, scorers,
  cards, group, updated table, scenario facts (Phase 2), plus tonight's fixtures with
  EEST times and computed stakes.
- Optional color: enable the web search tool for injury/controversy context, with the
  instruction that **qualification claims may only come from the provided scenario
  facts, never from search results**. Phase 1 may rely on search for scenario *flavor*
  but must hedge (see Phasing).
- System prompt requirements:
  - Romanian, diacritics, punchy register („DRAMĂ!" is on-brand), max 3 sentences per pill.
  - No invented facts; only the provided data. No player stats not present in input.
  - Output **only** strict JSON (no markdown fences), schema below; validate with zod
    and retry once on parse failure.
- Output schema (also the shape of `site/data/<date>.json` after merging with raw facts):

```json
{
  "date": "2026-06-18",
  "headline": "…",
  "summary": "…",
  "matches": [
    {
      "id": 12345,
      "home": "Germania", "away": "Japonia",
      "score": [1, 2],
      "scorers": ["Gnabry 33'", "Doan 75'", "Asano 82'"],
      "events": ["roșu Rüdiger 79'"],
      "group": "E",
      "pill": "…",
      "drama": 4
    }
  ],
  "groups": [
    { "name": "E", "table": [ { "team": "Spania", "p": 2, "gd": 6, "pts": 6, "status": "calificată" } ] }
  ],
  "tonight": [
    { "home": "Brazilia", "away": "Maroc", "kickoffEEST": "22:00", "alarm": "stai treaz", "why": "…" }
  ],
  "teaser": "⚽ <headline> · <n> meciuri azi-noapte\nhttps://<domain>"
}
```

- Secret: `GEMINI_API_KEY` (GitHub Actions secret; never shipped to the client).

### 4.5 OG image (`og-image.js`)
- 1200×630 PNG per day: date, headline, biggest score of the night. satori (JSX-less
  object syntax is fine) + @resvg/resvg-js; bundle a font with Romanian diacritics
  (e.g., Inter).
- Referenced from per-day OG tags so the WhatsApp preview card changes daily.

### 4.6 Site (`site/`)
- Vanilla static page; loads `data/latest.json` and renders. Mobile-first (everyone
  reads this on a phone in bed). Layout per the agreed mockup: headline → match cards
  with consequence pill + flame drama rating → group tables with status badges →
  tonight list with alarm badges.
- `arhiva.html`: date picker over the JSON files in `data/`.
- Share button: `https://wa.me/?text=<urlencoded teaser>` and `navigator.share` when
  available.
- OG tags: `og:title` = headline, `og:description` = summary, `og:image` = today's PNG.
  Because the page is static, inject these at pipeline time into `index.html` (simple
  token replacement) so previews are correct without JS.

### 4.7 Workflow (`.github/workflows/digest.yml`)
- `schedule: cron "30 4 * * *"` (04:30 UTC = 07:30 EEST during summer time) +
  `workflow_dispatch` for manual reruns.
- Steps: checkout → setup-node → `npm ci` → `node pipeline/run.js` → commit
  `site/data/*` and regenerated `index.html` → push → deploy `site/` to GitHub Pages
  via `actions/configure-pages` + `actions/upload-pages-artifact` + `actions/deploy-pages`.
- **Deploy in the same workflow run.** Commits made with the default `GITHUB_TOKEN`
  do not trigger other workflows, so a separate "deploy on push" workflow would never
  fire. The workflow needs `permissions: pages: write, id-token: write, contents: write`.
- Repo settings: Pages → Source = GitHub Actions. Site lives at
  `https://<user>.github.io/mondial/` (or a custom domain later). Free public-repo
  limits (soft 100 GB/month bandwidth, 1 GB site) are far beyond this site's needs.
- Scheduled-workflow quirks on free accounts: cron is auto-disabled after 60 days of
  repo inactivity (the pipeline's daily commits prevent this) and runs may start a few
  minutes late under load — both acceptable here.
- Failure handling: if the football API or Claude call fails, keep yesterday's
  `latest.json` untouched and exit non-zero so the run shows red in Actions (and skip
  the deploy step).

## 5. Phasing

- **Phase 1 (MVP, ship for the first matchdays):** fetch → narrate → render → share
  button. No scenario engine; scenarios barely exist on matchday 1–2 anyway. The
  prompt may use web search for color but must phrase qualification talk cautiously
  („pornește ca favorită", „și-a complicat viața") rather than asserting exact
  conditions.
- **Phase 2 (before matchday 3):** `scenarios.js` + tests + status upgrades. Pills now
  state exact conditions, sourced only from computed facts.
- **Phase 3 (nice-to-haves):** favorite-team highlighting, „surpriza nopții", knockout
  bracket view, fully automated WhatsApp posting (whatsapp-web.js on a spare number +
  small VPS) if the one-tap share ritual gets old.

## 6. Open decisions

- Domain name (the default `https://<user>.github.io/mondial/` works fine for day 1;
  a custom domain can be added in Pages settings later — Cloudflare Pages remains a
  fallback only if fancier needs ever appear).
- Exact visual theme (the mockup's card style is the reference).

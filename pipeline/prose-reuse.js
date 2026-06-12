/**
 * Rebuilds the narration object from a previously published digest so a run
 * can skip the Gemini call when facts are unchanged.
 *
 * Tonight entries are matched by id; digests written before ids were stored
 * fall back to home+away matching. Returns null when the stored digest cannot
 * cover the current facts — the caller then re-narrates.
 */
export function reuseNarration(stored, facts) {
  if (!stored?.headline || !stored?.summary) return null;

  const storedMatches = new Map((stored.matches ?? []).map((m) => [m.id, m]));
  const matches = [];
  for (const m of facts.finished) {
    const s = storedMatches.get(m.id);
    if (!s?.pill) return null;
    matches.push({ id: m.id, pill: s.pill, drama: s.drama ?? 1 });
  }

  const tonightById = new Map();
  const tonightByTeams = new Map();
  for (const t of stored.tonight ?? []) {
    if (t.id != null) tonightById.set(t.id, t);
    tonightByTeams.set(`${t.home}|${t.away}`, t);
  }
  const tonight = [];
  for (const f of facts.tonight) {
    const s = tonightById.get(f.id) ?? tonightByTeams.get(`${f.home}|${f.away}`);
    if (!s?.why) return null;
    tonight.push({ id: f.id, alarm: s.alarm, why: s.why });
  }

  return { headline: stored.headline, summary: stored.summary, matches, tonight };
}

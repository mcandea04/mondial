/* Renders a digest JSON into the page. Shared by index.html and arhiva.html. */

import { localize, localizeTeam, teamCode, UI_STRINGS, STATUS_LABEL, alarmIsWatch, alarmBadgeLabel, dateLabel, stageLabel } from './i18n.js';

const STATUS_BADGE = {
  'calificată': 'badge-ok',
  'în cărți': 'badge-good',
  'are nevoie de minune': 'badge-warn',
  'eliminată': 'badge-danger',
};

// The drama rating (1-5) renders as that many flames. The data scale stays 1-5;
// this only bounds it for display. Returns null for absent/non-positive ratings
// so missing data shows no flames at all, rather than a default count.
export function clampDrama(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 1) return null;
  return Math.min(5, Math.floor(n));
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function flagImg(code, sizeClass) {
  if (!code) return null;
  const img = el('img', sizeClass ? `flag ${sizeClass}` : 'flag');
  img.src = `assets/flags/${code}.svg`;
  img.alt = ''; // decorative; the team name beside it is the label
  img.setAttribute('aria-hidden', 'true');
  img.onerror = () => img.remove(); // a 404 leaves no broken-image box
  return img;
}

// A team in the scoreline: the FIFA tricode (compact, uniform width) with its
// flag inline. The full localized name rides along as the accessible label and
// tooltip, so the code is never the sole identifier. `side` places the flag
// 'before' the tricode (home) or 'after' it (away). Names with no known code
// (knockout placeholders) fall back to the full name.
function teamName(className, name, code, side, lang) {
  const fullName = localizeTeam(name, lang);
  const tricode = teamCode(name);
  const span = el('span', className, tricode ?? fullName);
  if (tricode) {
    span.title = fullName;
    span.setAttribute('aria-label', fullName);
  }
  const flag = flagImg(code, 'flag-inline');
  if (flag) span[side === 'before' ? 'prepend' : 'append'](flag);
  return span;
}

function renderHeader(root, digest, lang) {
  const t = UI_STRINGS[lang];
  const meta = el('div', 'meta');
  meta.append(
    el('span', null, `${dateLabel(digest.date, lang)} · ${t.nightHere}`),
    el('span', null, matchCountLabel(digest.matches.length, lang)),
  );
  root.append(meta, el('h1', null, localize(digest.headline, lang)), el('p', 'summary', localize(digest.summary, lang)));
}

function matchCountLabel(n, lang) {
  const t = UI_STRINGS[lang];
  if (n === 0) return t.noMatches;
  if (n === 1) return t.oneMatch;
  return t.manyMatches(n);
}

function renderMatchCard(match, lang) {
  const card = el('div', 'card');
  const label = stageLabel(match.stage, lang);
  if (label) card.append(el('p', 'card-label', label));
  const header = el('div', 'match-header');
  const teams = el('div', 'match-teams');
  const score = el('span', 'score', `${match.score[0]} – ${match.score[1]}`);
  teams.append(
    teamName('team-name home', match.home, match.homeCode, 'before', lang),
    score,
    teamName('team-name away', match.away, match.awayCode, 'after', lang),
  );
  const actions = el('div', 'match-actions');
  if (match.highlight) {
    const link = el('a', 'highlight-icon', '▷');
    link.href = match.highlight;
    link.target = '_blank';
    link.rel = 'noopener';
    link.setAttribute('aria-label', UI_STRINGS[lang].recapLabel);
    link.title = UI_STRINGS[lang].recapLabel;
    actions.append(link);
  }
  const rating = clampDrama(match.drama);
  if (rating !== null) {
    const label = UI_STRINGS[lang].drama(rating);
    const flames = el('span', 'flames');
    flames.setAttribute('aria-label', label);
    flames.title = label;
    for (let i = 0; i < rating; i += 1) {
      const flame = el('span', 'flame');
      flame.setAttribute('aria-hidden', 'true');
      flames.append(flame);
    }
    actions.append(flames);
  }
  header.append(teams, actions);
  card.append(header);

  const events = renderEvents(match, lang);
  if (events) card.append(events);

  const pillText = localize(match.pill, lang);
  if (pillText) {
    const pill = el('div', 'pill');
    pill.append(el('p', 'pill-text', pillText));
    card.append(pill);
  }

  return card;
}

/**
 * A team-colored event span: `${name} ${minute}'`, class `ev` plus the side.
 * Own goals carry the own-goal tag so the scorer reads against, not for, the
 * team colour they wear — `team` is the side that benefits, not the player's own.
 */
function eventSpan(event, lang) {
  const cls = event.team ? `ev ${event.team}` : 'ev';
  const tag = event.ownGoal ? ` (${UI_STRINGS[lang].ownGoal})` : '';
  const label = `${event.name}${tag} ${event.minute}'`;
  return el('span', cls, label);
}

/** A red-card event span: the goal span with a `■` mark prepended. */
function cardSpan(event, lang) {
  const span = eventSpan(event, lang);
  span.prepend(el('span', 'card-mark', '■ '));
  return span;
}

/** A line (`evline`) of event spans separated by ` · `. */
function eventLine(spans) {
  const line = el('p', 'evline');
  for (const span of spans) {
    if (line.childNodes.length) line.append(el('span', 'sep', '  ·  '));
    line.append(span);
  }
  return line;
}

/**
 * The goals line and (if any) the red-card line, plus a penalties note. Returns
 * null when there is nothing to show. The note rides on the last line as
 * ` · <penalties note>`, or stands alone when there are no events.
 */
function renderEvents(match, lang) {
  const lines = [];
  if (match.scorers.length) lines.push(eventLine(match.scorers.map((e) => eventSpan(e, lang))));
  if (match.events.length) lines.push(eventLine(match.events.map((e) => cardSpan(e, lang))));

  if (match.decidedOnPenalties) {
    const note = UI_STRINGS[lang].penalties;
    const lastLine = lines[lines.length - 1];
    if (lastLine) {
      lastLine.append(el('span', 'sep', `  ·  ${note}`));
    } else {
      const line = el('p', 'evline');
      line.append(el('span', null, note));
      lines.push(line);
    }
  }

  if (lines.length === 0) return null;
  const wrap = el('div', 'events');
  wrap.append(...lines);
  return wrap;
}

function teamCell(row, lang) {
  const td = el('td', null);
  const wrap = el('span', 'team');
  wrap.append(...[flagImg(row.code, 'flag-sm'), el('span', 'team-name', localizeTeam(row.team, lang))].filter(Boolean));
  td.append(wrap);
  return td;
}

function renderGroupCard(group, lang) {
  const t = UI_STRINGS[lang];
  const card = el('div', 'card');
  card.append(el('p', 'card-label', t.group(group.name)));

  const table = el('table');
  const thead = el('thead');
  const headRow = el('tr');
  for (const [label, cls] of [
    [t.colTeam, 'col-team'],
    [t.colPlayed, 'col-num'],
    [t.colGd, 'col-num'],
    [t.colPts, 'col-num'],
    [t.colStatus, 'col-stat'],
  ]) {
    headRow.append(el('td', cls, label));
  }
  thead.append(headRow);

  const tbody = el('tbody');
  for (const row of group.table) {
    const tr = el('tr');
    tr.append(
      teamCell(row, lang),
      el('td', 'col-num', String(row.p)),
      el('td', 'col-num', row.gd > 0 ? `+${row.gd}` : String(row.gd)),
      el('td', 'col-num pts', String(row.pts)),
    );
    const statusCell = el('td', 'col-stat');
    const labelText = STATUS_LABEL[lang][row.status] ?? row.status;
    statusCell.append(el('span', `badge ${STATUS_BADGE[row.status] ?? 'badge-muted'}`, labelText));
    tr.append(statusCell);
    tbody.append(tr);
  }
  table.append(thead, tbody);
  card.append(table);
  return card;
}

function tonightRow(fixture, lang) {
  const t = UI_STRINGS[lang];
  const row = el('div', 'tonight-row');
  const left = el('div');
  const matchLine = el('span', 'team');
  matchLine.append(
    ...[
      flagImg(fixture.homeCode, 'flag-sm'),
      el('span', 'tonight-match', `${teamCode(fixture.home) ?? localizeTeam(fixture.home, lang)} – ${teamCode(fixture.away) ?? localizeTeam(fixture.away, lang)}`),
      flagImg(fixture.awayCode, 'flag-sm'),
    ].filter(Boolean),
  );
  const watch = alarmIsWatch(localize(fixture.alarm, 'ro'));
  const badgeClass = watch ? 'badge-ok' : 'badge-muted';
  left.append(
    matchLine,
    el('span', 'tonight-time', ` · ${fixture.kickoffEEST} ${t.eest}`),
    ...(stageLabel(fixture.stage, lang) ? [el('span', 'badge badge-muted', stageLabel(fixture.stage, lang))] : []),
    el('span', `badge ${badgeClass}`, alarmBadgeLabel(watch, lang)),
  );
  const whyText = localize(fixture.why, lang);
  if (whyText) {
    left.append(el('br'), el('span', 'tonight-why', whyText));
  }
  row.append(left);
  return row;
}

function renderTonight(tonight, groupScenarios, lang) {
  const t = UI_STRINGS[lang];
  const card = el('div', 'card');
  card.append(el('p', 'card-label', t.tonightTitle));

  // `tonight` arrives in kickoff order. Walk it once and emit each fixture in
  // place, so a decisive group's cluster (its pair of finals + the joint scenario
  // paragraph) appears at the chronological slot of its first kickoff rather than
  // jumping to the front. Every non-decisive fixture stays inline in the same
  // chronological flow.
  const byGroup = new Map((groupScenarios ?? []).map((g) => [g.name, g]));
  const rendered = new Set();

  for (const fixture of tonight) {
    if (rendered.has(fixture)) continue;
    const group = fixture.group != null ? byGroup.get(fixture.group) : null;
    const fixtures = group ? tonight.filter((f) => f.group === fixture.group) : [];
    if (group && fixtures.length >= 2) {
      const block = el('div', 'tonight-group');
      block.append(el('p', 'tonight-group-label', t.decisiveRound(fixture.group)));
      for (const f of fixtures) {
        rendered.add(f);
        block.append(tonightRow(f, lang));
      }
      const proseText = localize(group.prose, lang);
      if (proseText) block.append(el('p', 'tonight-group-scenario', proseText));
      card.append(block);
    } else {
      rendered.add(fixture);
      card.append(tonightRow(fixture, lang));
    }
  }
  return card;
}

function renderShareBar(digest, lang) {
  const t = UI_STRINGS[lang];
  const shareText = localize(digest.teaser, lang);
  const bar = el('div', 'share-bar');
  bar.append(el('div', 'share-text', shareText));

  const waLink = el('a', 'share-btn', t.share);
  waLink.href = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
  waLink.target = '_blank';
  waLink.rel = 'noopener';
  waLink.addEventListener('click', (event) => {
    window.goatcounter?.count?.({ path: 'share-whatsapp', title: 'WhatsApp share', event: true });
    if (navigator.share) {
      event.preventDefault();
      navigator.share({ text: shareText }).catch(() => {});
    }
  });
  bar.append(waLink);
  return bar;
}

export function renderDigest(root, digest, lang = 'ro') {
  root.replaceChildren();
  renderHeader(root, digest, lang);

  if (digest.matches.length === 0) {
    const emptyCard = el('div', 'card');
    emptyCard.append(el('p', 'empty-state', UI_STRINGS[lang].emptyNight));
    root.append(emptyCard);
  }
  for (const match of digest.matches) root.append(renderMatchCard(match, lang));
  for (const group of digest.groups ?? []) root.append(renderGroupCard(group, lang));
  if ((digest.tonight ?? []).length) root.append(renderTonight(digest.tonight, digest.groupScenarios, lang));
  root.append(renderShareBar(digest, lang));
}

export async function loadDigest(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Nu am putut încărca ${url} (${response.status})`);
  return response.json();
}

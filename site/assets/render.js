/* Renders a digest JSON into the page. Shared by index.html and arhiva.html. */

import { localize, localizeTeam, UI_STRINGS, STATUS_LABEL, alarmIsWatch, alarmBadgeLabel, dateLabel } from './i18n.js';

const STATUS_BADGE = {
  'calificată': 'badge-ok',
  'în cărți': 'badge-good',
  'are nevoie de minune': 'badge-warn',
  'eliminată': 'badge-danger',
};

// Drama 1-5 → one colored thermal face whose hue rises with the rating. The
// data scale stays 1-5; only the rendering collapses to a single glyph. Returns
// null for absent/non-positive ratings so missing data shows no face (matching
// the old empty flame row), rather than a spurious cold face.
const DRAMA_FACES = ['🥶', '😐', '🥵', '🤯', '🤯'];

export function clampDrama(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 1) return null;
  return Math.min(5, Math.floor(n));
}

export function dramaFace(n) {
  const rating = clampDrama(n);
  return rating === null ? null : DRAMA_FACES[rating - 1];
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

// A team name with its flag inline, so the flag flows with the text and stays
// next to the name even when a long name wraps. `side` places the flag 'before'
// the name (home) or 'after' it (away).
function teamName(className, name, code, side, lang) {
  const span = el('span', className, localizeTeam(name, lang));
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
  const header = el('div', 'match-header');
  const teams = el('div', 'match-teams');
  const score = el('span', 'score', `${match.score[0]} – ${match.score[1]}`);
  teams.append(
    teamName('team-name home', match.home, match.homeCode, 'before', lang),
    score,
    teamName('team-name away', match.away, match.awayCode, 'after', lang),
  );
  const actions = el('div', 'match-actions');
  const face = dramaFace(match.drama);
  if (face) {
    const rating = clampDrama(match.drama);
    const label = UI_STRINGS[lang].drama(rating);
    const faceSpan = el('span', 'drama-face', face);
    faceSpan.setAttribute('aria-label', label);
    faceSpan.title = label;
    actions.append(faceSpan);
  }
  if (match.highlight) {
    const link = el('a', 'highlight-icon', '▷');
    link.href = match.highlight;
    link.target = '_blank';
    link.rel = 'noopener';
    link.setAttribute('aria-label', UI_STRINGS[lang].recapLabel);
    link.title = UI_STRINGS[lang].recapLabel;
    actions.append(link);
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

function renderTonight(tonight, lang) {
  const t = UI_STRINGS[lang];
  const card = el('div', 'card');
  card.append(el('p', 'card-label', t.tonightTitle));
  for (const fixture of tonight) {
    const row = el('div', 'tonight-row');
    const left = el('div');
    const matchLine = el('span', 'team');
    matchLine.append(
      ...[
        flagImg(fixture.homeCode, 'flag-sm'),
        el('span', 'tonight-match', `${localizeTeam(fixture.home, lang)} – ${localizeTeam(fixture.away, lang)}`),
        flagImg(fixture.awayCode, 'flag-sm'),
      ].filter(Boolean),
    );
    left.append(matchLine, el('span', 'tonight-time', ` · ${fixture.kickoffEEST} ${t.eest}`));
    const whyText = localize(fixture.why, lang);
    if (whyText) {
      left.append(el('br'), el('span', 'tonight-why', whyText));
    }
    // The watch/skip verdict is a single judgment, not a per-language opinion:
    // the Romanian alarm is canonical, and the badge label is its localized form.
    // Only the `why` wording differs by language. This keeps RO and EN from
    // disagreeing on whether a match is worth the alarm.
    const watch = alarmIsWatch(localize(fixture.alarm, 'ro'));
    const badgeClass = watch ? 'badge-ok' : 'badge-muted';
    row.append(left, el('span', `badge ${badgeClass}`, alarmBadgeLabel(watch, lang)));
    card.append(row);
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
  for (const group of digest.groups) root.append(renderGroupCard(group, lang));
  if (digest.tonight.length) root.append(renderTonight(digest.tonight, lang));
  root.append(renderShareBar(digest, lang));
}

export async function loadDigest(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Nu am putut încărca ${url} (${response.status})`);
  return response.json();
}

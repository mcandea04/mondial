/* Renders a digest JSON into the page. Shared by index.html and arhiva.html. */

const STATUS_BADGE = {
  'calificată': 'badge-ok',
  'în cărți': 'badge-good',
  'are nevoie de minune': 'badge-warn',
  'eliminată': 'badge-danger',
};

const WEEKDAY_FMT = new Intl.DateTimeFormat('ro-RO', {
  timeZone: 'Europe/Bucharest',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

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
function teamName(className, name, code, side) {
  const span = el('span', className, name);
  const flag = flagImg(code, 'flag-inline');
  if (flag) span[side === 'before' ? 'prepend' : 'append'](flag);
  return span;
}

function renderHeader(root, digest) {
  const meta = el('div', 'meta');
  const dateLabel = WEEKDAY_FMT.format(new Date(`${digest.date}T06:00:00Z`));
  meta.append(
    el('span', null, `${capitalize(dateLabel)} · azi-noapte la Mondial`),
    el('span', null, matchCountLabel(digest.matches.length)),
  );
  root.append(meta, el('h1', null, digest.headline), el('p', 'summary', digest.summary));
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function matchCountLabel(n) {
  if (n === 0) return 'fără meciuri';
  if (n === 1) return '1 meci';
  return `${n} meciuri`;
}

function renderMatchCard(match) {
  const card = el('div', 'card');

  const header = el('div', 'match-header');
  const teams = el('div', 'match-teams');

  const score = el('span', 'score', `${match.score[0]} – ${match.score[1]}`);

  teams.append(
    teamName('team-name home', match.home, match.homeCode, 'before'),
    score,
    teamName('team-name away', match.away, match.awayCode, 'after'),
  );
  const flames = el('div', 'flames');
  flames.setAttribute('aria-label', `dramă ${match.drama} din 5`);
  for (let i = 0; i < match.drama; i += 1) {
    const flame = el('span', 'flame');
    flame.setAttribute('aria-hidden', 'true');
    flames.append(flame);
  }
  header.append(teams, flames);
  card.append(header);

  const events = renderEvents(match);
  if (events) card.append(events);

  if (match.pill) {
    const pill = el('div', 'pill');
    pill.append(el('p', 'pill-text', match.pill));
    card.append(pill);
  }

  if (match.highlight) {
    const link = el('a', 'highlight', '▶ Rezumat');
    link.href = match.highlight;
    link.target = '_blank';
    link.rel = 'noopener';
    card.append(link);
  }
  return card;
}

/**
 * A team-colored event span: `${name} ${minute}'`, class `ev` plus the side.
 * Own goals carry the `(autogol)` tag so the scorer reads against, not for, the
 * team colour they wear — `team` is the side that benefits, not the player's own.
 */
function eventSpan(event) {
  const cls = event.team ? `ev ${event.team}` : 'ev';
  const tag = event.ownGoal ? ' (autogol)' : '';
  const label = `${event.name}${tag} ${event.minute}'`;
  return el('span', cls, label);
}

/** A red-card event span: the goal span with a `■` mark prepended. */
function cardSpan(event) {
  const span = eventSpan(event);
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
 * ` · decis la penalty-uri`, or stands alone when there are no events.
 */
function renderEvents(match) {
  const lines = [];
  if (match.scorers.length) lines.push(eventLine(match.scorers.map(eventSpan)));
  if (match.events.length) lines.push(eventLine(match.events.map(cardSpan)));

  if (match.decidedOnPenalties) {
    const lastLine = lines[lines.length - 1];
    if (lastLine) {
      lastLine.append(el('span', 'sep', '  ·  decis la penalty-uri'));
    } else {
      const note = el('p', 'evline');
      note.append(el('span', null, 'decis la penalty-uri'));
      lines.push(note);
    }
  }

  if (lines.length === 0) return null;
  const wrap = el('div', 'events');
  wrap.append(...lines);
  return wrap;
}

function teamCell(row) {
  const td = el('td', null);
  const wrap = el('span', 'team');
  wrap.append(...[flagImg(row.code, 'flag-sm'), el('span', 'team-name', row.team)].filter(Boolean));
  td.append(wrap);
  return td;
}

function renderGroupCard(group) {
  const card = el('div', 'card');
  card.append(el('p', 'card-label', `Grupa ${group.name}`));

  const table = el('table');
  const thead = el('thead');
  const headRow = el('tr');
  for (const [label, cls] of [
    ['Echipă', 'col-team'],
    ['MJ', 'col-num'],
    ['GD', 'col-num'],
    ['Pct', 'col-num'],
    ['Status', 'col-stat'],
  ]) {
    headRow.append(el('td', cls, label));
  }
  thead.append(headRow);

  const tbody = el('tbody');
  for (const row of group.table) {
    const tr = el('tr');
    tr.append(
      teamCell(row),
      el('td', 'col-num', String(row.p)),
      el('td', 'col-num', row.gd > 0 ? `+${row.gd}` : String(row.gd)),
      el('td', 'col-num pts', String(row.pts)),
    );
    const statusCell = el('td', 'col-stat');
    statusCell.append(el('span', `badge ${STATUS_BADGE[row.status] ?? 'badge-muted'}`, row.status));
    tr.append(statusCell);
    tbody.append(tr);
  }
  table.append(thead, tbody);
  card.append(table);
  return card;
}

function renderTonight(tonight) {
  const card = el('div', 'card');
  card.append(el('p', 'card-label', 'La noapte — merită alarma?'));
  for (const fixture of tonight) {
    const row = el('div', 'tonight-row');
    const left = el('div');
    const matchLine = el('span', 'team');
    matchLine.append(
      ...[
        flagImg(fixture.homeCode, 'flag-sm'),
        el('span', 'tonight-match', `${fixture.home} – ${fixture.away}`),
        flagImg(fixture.awayCode, 'flag-sm'),
      ].filter(Boolean),
    );
    left.append(matchLine, el('span', 'tonight-time', ` · ${fixture.kickoffEEST} EEST`));
    if (fixture.why) {
      left.append(el('br'), el('span', 'tonight-why', fixture.why));
    }
    const badgeClass = fixture.alarm === 'merită văzut' ? 'badge-ok' : 'badge-muted';
    row.append(left, el('span', `badge ${badgeClass}`, fixture.alarm));
    card.append(row);
  }
  return card;
}

function renderShareBar(digest) {
  const bar = el('div', 'share-bar');
  bar.append(el('div', 'share-text', digest.teaser));

  const waLink = el('a', 'share-btn', 'Share ↗');
  waLink.href = `https://wa.me/?text=${encodeURIComponent(digest.teaser)}`;
  waLink.target = '_blank';
  waLink.rel = 'noopener';
  waLink.addEventListener('click', (event) => {
    window.goatcounter?.count?.({ path: 'share-whatsapp', title: 'WhatsApp share', event: true });
    if (navigator.share) {
      event.preventDefault();
      navigator.share({ text: digest.teaser }).catch(() => {});
    }
  });
  bar.append(waLink);
  return bar;
}

export function renderDigest(root, digest) {
  root.replaceChildren();
  renderHeader(root, digest);

  if (digest.matches.length === 0) {
    const emptyCard = el('div', 'card');
    emptyCard.append(
      el('p', 'empty-state', 'Azi-noapte nu s-a jucat niciun meci. Vezi mai jos ce urmează.'),
    );
    root.append(emptyCard);
  }
  for (const match of digest.matches) root.append(renderMatchCard(match));
  for (const group of digest.groups) root.append(renderGroupCard(group));
  if (digest.tonight.length) root.append(renderTonight(digest.tonight));
  root.append(renderShareBar(digest));
}

export async function loadDigest(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Nu am putut încărca ${url} (${response.status})`);
  return response.json();
}

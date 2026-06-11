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
  teams.append(
    el('span', 'team-name', match.home),
    el('span', 'score', `${match.score[0]} – ${match.score[1]}`),
    el('span', 'team-name', match.away),
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

  if (match.scorers.length || match.events.length) {
    const line = el('p', 'scorers');
    line.append(match.scorers.join('  ·  '));
    for (const event of match.events) {
      if (line.childNodes.length) line.append('  ·  ');
      line.append(el('span', 'red-card', `■ ${event}`));
    }
    card.append(line);
  }

  if (match.pill) {
    const pill = el('div', 'pill');
    pill.append(
      el('p', 'pill-label', 'Pastila de consecințe'),
      el('p', 'pill-text', match.pill),
    );
    card.append(pill);
  }
  return card;
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
      el('td', null, row.team),
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
    left.append(
      el('span', 'tonight-match', `${fixture.home} – ${fixture.away}`),
      el('span', 'tonight-time', ` · ${fixture.kickoffEEST} EEST`),
    );
    if (fixture.why) {
      left.append(el('br'), el('span', 'tonight-why', fixture.why));
    }
    const badgeClass = fixture.alarm === 'stai treaz' ? 'badge-ok' : 'badge-muted';
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
  if (navigator.share) {
    waLink.addEventListener('click', (event) => {
      event.preventDefault();
      navigator.share({ text: digest.teaser }).catch(() => {});
    });
  }
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

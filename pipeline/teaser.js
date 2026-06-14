/** WhatsApp share text: headline + match count + URL. */

function gamesLabel(matchCount) {
  if (matchCount === 0) return 'pauză azi-noapte';
  const matches = matchCount === 1 ? '1 meci' : `${matchCount} meciuri`;
  return `${matches} azi-noapte, cu rezumate video`;
}

export function buildTeaser({ headline, matchCount, siteUrl }) {
  return `⚽ ${headline} · ${gamesLabel(matchCount)}\n${siteUrl}`;
}

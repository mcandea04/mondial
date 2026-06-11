/** WhatsApp share text: headline + match count + URL. */

function gamesLabel(matchCount) {
  if (matchCount === 0) return 'pauză azi-noapte';
  if (matchCount === 1) return '1 meci azi-noapte';
  return `${matchCount} meciuri azi-noapte`;
}

export function buildTeaser({ headline, matchCount, siteUrl }) {
  return `⚽ ${headline} · ${gamesLabel(matchCount)}\n${siteUrl}`;
}

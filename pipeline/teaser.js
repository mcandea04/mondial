/** WhatsApp share text: headline + match count + URL. */

function gamesLabel(matchCount) {
  if (matchCount === 0) return 'pauză azi-noapte';
  const matches = matchCount === 1 ? '1 meci' : `${matchCount} meciuri`;
  return `${matches} azi-noapte, cu rezumate video`;
}

export function buildTeaser({ headline, matchCount, siteUrl }) {
  return `⚽ ${headline} · ${gamesLabel(matchCount)}\n${siteUrl}`;
}

function gamesLabelEn(matchCount) {
  if (matchCount === 0) return 'no matches overnight';
  const matches = matchCount === 1 ? '1 match' : `${matchCount} matches`;
  return `${matches} overnight, with video highlights`;
}

export function buildTeaserEn({ headline, matchCount, siteUrl }) {
  return `⚽ ${headline} · ${gamesLabelEn(matchCount)}\n${siteUrl}`;
}

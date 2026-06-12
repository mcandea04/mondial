/** WhatsApp share text: headline + match count (+ recap count) + URL. */

function gamesLabel(matchCount, recapCount) {
  if (matchCount === 0) return 'pauză azi-noapte';
  const matches = matchCount === 1 ? '1 meci' : `${matchCount} meciuri`;
  if (recapCount > 0) {
    const recaps = recapCount === 1 ? '1 rezumat video' : `${recapCount} rezumate video`;
    return `${matches} + ${recaps} azi-noapte`;
  }
  return `${matches} azi-noapte`;
}

export function buildTeaser({ headline, matchCount, recapCount = 0, siteUrl }) {
  return `⚽ ${headline} · ${gamesLabel(matchCount, recapCount)}\n${siteUrl}`;
}

/**
 * Daily Open Graph image: 1200×630 PNG with date, headline, and the night's
 * biggest score. satori (object syntax) + resvg.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const fontPath = (name) =>
  fileURLToPath(new URL(`./fonts/${name}`, import.meta.url));

function el(type, style, children) {
  return { type, props: { style, children } };
}

/** Picks the match with the most goals (drama proxy) for the image footer. */
function biggestMatch(matches) {
  if (!matches.length) return null;
  return [...matches].sort(
    (a, b) => b.score[0] + b.score[1] - (a.score[0] + a.score[1]),
  )[0];
}

export async function renderOgImage({ date, headline, matches }) {
  const [regular, semibold] = await Promise.all([
    readFile(fontPath('Inter-Regular.ttf')),
    readFile(fontPath('Inter-SemiBold.ttf')),
  ]);

  const top = biggestMatch(matches);
  const dateLabel = new Intl.DateTimeFormat('ro-RO', {
    timeZone: 'Europe/Bucharest',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${date}T06:00:00Z`));

  const children = [
    el('div', { fontSize: 30, color: '#9e9d98' }, `${dateLabel} · azi-noapte la Mondial`),
    el(
      'div',
      {
        fontSize: 64,
        fontWeight: 600,
        color: '#f0ede6',
        lineHeight: 1.2,
        marginTop: 24,
      },
      headline,
    ),
  ];
  if (top) {
    children.push(
      el(
        'div',
        { fontSize: 40, color: '#f0997b', marginTop: 'auto' },
        `${top.home} ${top.score[0]} – ${top.score[1]} ${top.away}`,
      ),
    );
  }
  const recapCount = matches.filter((m) => m.highlight).length;
  if (recapCount > 0) {
    children.push(
      el(
        'div',
        { fontSize: 28, color: '#9e9d98', marginTop: top ? 12 : 'auto' },
        '▶ cu rezumate video',
      ),
    );
  }

  const svg = await satori(
    el(
      'div',
      {
        width: 1200,
        height: 630,
        display: 'flex',
        flexDirection: 'column',
        padding: 64,
        backgroundColor: '#1c1c1a',
        fontFamily: 'Inter',
      },
      children,
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: 'Inter', data: regular, weight: 400, style: 'normal' },
        { name: 'Inter', data: semibold, weight: 600, style: 'normal' },
      ],
    },
  );

  return new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
}

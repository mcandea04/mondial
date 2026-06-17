/* Pure, framework-free localization helpers shared by render.js. No DOM here. */

// Watch-tonight alarm tokens across both languages plus the legacy RO value
// (`stai treaz`) that older archive days stored before the enum settled.
export const WATCH_ALARMS = new Set(['merită văzut', 'stai treaz', 'stay up']);

export function alarmIsWatch(value) {
  return WATCH_ALARMS.has(value);
}

/**
 * Reads a prose field for the active language. A plain string is legacy RO-only
 * and passes through; an object is per-language with an ro fallback.
 */
export function localize(field, lang) {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  return field[lang] ?? field.ro ?? '';
}

export const UI_STRINGS = {
  ro: {
    nightHere: 'azi-noapte la Mondial',
    noMatches: 'fără meciuri',
    oneMatch: '1 meci',
    manyMatches: (n) => `${n} meciuri`,
    emptyNight: 'Azi-noapte nu s-a jucat niciun meci. Vezi mai jos ce urmează.',
    tonightTitle: 'La noapte — merită alarma?',
    group: (name) => `Grupa ${name}`,
    colTeam: 'Echipă',
    colPlayed: 'MJ',
    colGd: 'GD',
    colPts: 'Pct',
    colStatus: 'Status',
    recap: '▶ Rezumat',
    share: 'Share ↗',
    eest: 'EEST',
  },
  en: {
    nightHere: 'last night at the World Cup',
    noMatches: 'no matches',
    oneMatch: '1 match',
    manyMatches: (n) => `${n} matches`,
    emptyNight: 'No matches were played last night. See what is coming up below.',
    tonightTitle: 'Tonight — worth the alarm?',
    group: (name) => `Group ${name}`,
    colTeam: 'Team',
    colPlayed: 'P',
    colGd: 'GD',
    colPts: 'Pts',
    colStatus: 'Status',
    recap: '▶ Highlights',
    share: 'Share ↗',
    eest: 'EEST',
  },
};

export const STATUS_LABEL = {
  ro: {
    'calificată': 'calificată',
    'în cărți': 'în cărți',
    'are nevoie de minune': 'are nevoie de minune',
    'eliminată': 'eliminată',
  },
  en: {
    'calificată': 'through',
    'în cărți': 'in the mix',
    'are nevoie de minune': 'needs a miracle',
    'eliminată': 'out',
  },
};

const WEEKDAY_FMT = {
  ro: new Intl.DateTimeFormat('ro-RO', { timeZone: 'Europe/Bucharest', weekday: 'long', day: 'numeric', month: 'long' }),
  en: new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', weekday: 'long', day: 'numeric', month: 'long' }),
};

export function dateLabel(date, lang) {
  const label = (WEEKDAY_FMT[lang] ?? WEEKDAY_FMT.ro).format(new Date(`${date}T06:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

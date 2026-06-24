/* Pure, framework-free localization helpers shared by render.js. No DOM here. */

// Watch-tonight alarm tokens across both languages plus the legacy RO value
// (`stai treaz`) that older archive days stored before the enum settled.
export const WATCH_ALARMS = new Set(['merită văzut', 'stai treaz', 'worth watching']);

export function alarmIsWatch(value) {
  return WATCH_ALARMS.has(value);
}

// The tonight badge shows a single canonical verdict (watch vs skip) in the
// active language, rather than each language's own model-written alarm string —
// so RO and EN never disagree on whether a match is worth the alarm.
export function alarmBadgeLabel(watch, lang) {
  const t = UI_STRINGS[lang] ?? UI_STRINGS.ro;
  return watch ? t.alarmWatch : t.alarmSkip;
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
    decisiveRound: (name) => `Grupa ${name} — ultima etapă`,
    colTeam: 'Echipă',
    colPlayed: 'MJ',
    colGd: 'GD',
    colPts: 'Pct',
    colStatus: 'Status',
    recapLabel: 'Rezumat video',
    share: 'Share ↗',
    eest: 'EEST',
    alarmWatch: 'merită văzut',
    alarmSkip: 'citești dimineața',
    ownGoal: 'autogol',
    penalties: 'decis la penalty-uri',
    drama: (n) => `dramă ${n} din 5`,
    archiveTitle: 'Arhiva dimineților',
    chooseDay: 'Alege o dimineață',
    backToday: '← azi',
    loading: 'Se încarcă…',
    emptyArchive: 'Arhiva e încă goală.',
    recaps: '▶ rezumate',
    recapsTitle: (n) => (n === 1 ? '1 rezumat video' : `${n} rezumate video`),
    noDigest: (date) => `Nu există digest pentru ${date}.`,
    notReady: (msg) => `Digestul de azi nu e încă gata. (${msg})`,
  },
  en: {
    nightHere: 'last night at the World Cup',
    noMatches: 'no matches',
    oneMatch: '1 match',
    manyMatches: (n) => `${n} matches`,
    emptyNight: 'No matches were played last night. See what is coming up below.',
    tonightTitle: 'Tonight — worth the alarm?',
    group: (name) => `Group ${name}`,
    decisiveRound: (name) => `Group ${name} — final round`,
    colTeam: 'Team',
    colPlayed: 'P',
    colGd: 'GD',
    colPts: 'Pts',
    colStatus: 'Status',
    recapLabel: 'Highlights',
    share: 'Share ↗',
    eest: 'EEST',
    alarmWatch: 'worth watching',
    alarmSkip: 'catch it later',
    ownGoal: 'own goal',
    penalties: 'decided on penalties',
    drama: (n) => `drama ${n} of 5`,
    archiveTitle: 'Morning archive',
    chooseDay: 'Pick a morning',
    backToday: '← today',
    loading: 'Loading…',
    emptyArchive: 'The archive is still empty.',
    recaps: '▶ highlights',
    recapsTitle: (n) => (n === 1 ? '1 video highlight' : `${n} video highlights`),
    noDigest: (date) => `No digest for ${date}.`,
    notReady: (msg) => `Today's digest is not ready yet. (${msg})`,
  },
};

// Romanian team exonym → English display name. Only entries that differ from
// the English name are listed; everything else (identical names, knockout
// placeholders) passes through. Source of truth for the names is
// pipeline/teams.js (ROMANIAN_NAMES); keep this in sync if that table changes.
export const TEAM_NAME_EN = {
  'Belgia': 'Belgium',
  'Bosnia și Herțegovina': 'Bosnia & Herzegovina',
  'Brazilia': 'Brazil',
  'Capul Verde': 'Cape Verde',
  'Columbia': 'Colombia',
  'RD Congo': 'DR Congo',
  'Croația': 'Croatia',
  'Cehia': 'Czechia',
  'Egipt': 'Egypt',
  'Anglia': 'England',
  'Franța': 'France',
  'Germania': 'Germany',
  'Irak': 'Iraq',
  'Coasta de Fildeș': 'Ivory Coast',
  'Japonia': 'Japan',
  'Iordania': 'Jordan',
  'Mexic': 'Mexico',
  'Maroc': 'Morocco',
  'Olanda': 'Netherlands',
  'Noua Zeelandă': 'New Zealand',
  'Norvegia': 'Norway',
  'Portugalia': 'Portugal',
  'Arabia Saudită': 'Saudi Arabia',
  'Scoția': 'Scotland',
  'Africa de Sud': 'South Africa',
  'Coreea de Sud': 'South Korea',
  'Spania': 'Spain',
  'Suedia': 'Sweden',
  'Elveția': 'Switzerland',
  'Turcia': 'Turkey',
  'SUA': 'USA',
};

// Team names are stored in the digest as Romanian exonyms (the fact layer is
// Romanian). For English, map them through; unknown names pass through unchanged.
export function localizeTeam(name, lang) {
  if (lang !== 'en') return name;
  return TEAM_NAME_EN[name] ?? name;
}

// Romanian team exonym → FIFA tricode for the compact scoreline. Keyed by the
// stored Romanian name so it works on the committed archive without a pipeline
// rerun. The codes are the same FIFA tricodes pipeline/teams.js uses in
// FIFA_TRICODE_TO_FLAG; keep the two in sync. Unknown names (knockout
// placeholders) return null so the renderer falls back to the full name.
export const TEAM_CODE = {
  'Algeria': 'ALG',
  'Argentina': 'ARG',
  'Australia': 'AUS',
  'Austria': 'AUT',
  'Belgia': 'BEL',
  'Bosnia și Herțegovina': 'BIH',
  'Brazilia': 'BRA',
  'Canada': 'CAN',
  'Capul Verde': 'CPV',
  'Columbia': 'COL',
  'RD Congo': 'COD',
  'Croația': 'CRO',
  'Curaçao': 'CUW',
  'Cehia': 'CZE',
  'Ecuador': 'ECU',
  'Egipt': 'EGY',
  'Anglia': 'ENG',
  'Franța': 'FRA',
  'Germania': 'GER',
  'Ghana': 'GHA',
  'Haiti': 'HAI',
  'Iran': 'IRN',
  'Irak': 'IRQ',
  'Coasta de Fildeș': 'CIV',
  'Japonia': 'JPN',
  'Iordania': 'JOR',
  'Mexic': 'MEX',
  'Maroc': 'MAR',
  'Olanda': 'NED',
  'Noua Zeelandă': 'NZL',
  'Norvegia': 'NOR',
  'Panama': 'PAN',
  'Paraguay': 'PAR',
  'Portugalia': 'POR',
  'Qatar': 'QAT',
  'Arabia Saudită': 'KSA',
  'Scoția': 'SCO',
  'Senegal': 'SEN',
  'Africa de Sud': 'RSA',
  'Coreea de Sud': 'KOR',
  'Spania': 'ESP',
  'Suedia': 'SWE',
  'Elveția': 'SUI',
  'Tunisia': 'TUN',
  'Turcia': 'TUR',
  'SUA': 'USA',
  'Uruguay': 'URU',
  'Uzbekistan': 'UZB',
};

// The scoreline shows the FIFA tricode (compact, uniform width). Returns null for
// unknown/placeholder names so the caller can fall back to the full team name.
export function teamCode(name) {
  return TEAM_CODE[name] ?? null;
}

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

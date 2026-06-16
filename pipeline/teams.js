/**
 * Romanian exonyms for the 48 World Cup 2026 teams, keyed by the exact
 * English names football-data.org uses. Unknown names (e.g. knockout
 * placeholders like "Winner Group A") pass through unchanged.
 */

const ROMANIAN_NAMES = {
  'Algeria': 'Algeria',
  'Argentina': 'Argentina',
  'Australia': 'Australia',
  'Austria': 'Austria',
  'Belgium': 'Belgia',
  'Bosnia-Herzegovina': 'Bosnia și Herțegovina',
  'Brazil': 'Brazilia',
  'Canada': 'Canada',
  'Cape Verde Islands': 'Capul Verde',
  'Colombia': 'Columbia',
  'Congo DR': 'RD Congo',
  'Croatia': 'Croația',
  'Curaçao': 'Curaçao',
  'Czechia': 'Cehia',
  'Ecuador': 'Ecuador',
  'Egypt': 'Egipt',
  'England': 'Anglia',
  'France': 'Franța',
  'Germany': 'Germania',
  'Ghana': 'Ghana',
  'Haiti': 'Haiti',
  'Iran': 'Iran',
  'Iraq': 'Irak',
  'Ivory Coast': 'Coasta de Fildeș',
  'Japan': 'Japonia',
  'Jordan': 'Iordania',
  'Mexico': 'Mexic',
  'Morocco': 'Maroc',
  'Netherlands': 'Olanda',
  'New Zealand': 'Noua Zeelandă',
  'Norway': 'Norvegia',
  'Panama': 'Panama',
  'Paraguay': 'Paraguay',
  'Portugal': 'Portugalia',
  'Qatar': 'Qatar',
  'Saudi Arabia': 'Arabia Saudită',
  'Scotland': 'Scoția',
  'Senegal': 'Senegal',
  'South Africa': 'Africa de Sud',
  'South Korea': 'Coreea de Sud',
  'Spain': 'Spania',
  'Sweden': 'Suedia',
  'Switzerland': 'Elveția',
  'Tunisia': 'Tunisia',
  'Turkey': 'Turcia',
  'Türkiye': 'Turcia',
  'Korea Republic': 'Coreea de Sud',
  'Cape Verde': 'Capul Verde',
  'DR Congo': 'RD Congo',
  'Bosnia and Herzegovina': 'Bosnia și Herțegovina',
  'United States': 'SUA',
  'Uruguay': 'Uruguay',
  'Uzbekistan': 'Uzbekistan',
};

export function romanianTeamName(name) {
  return ROMANIAN_NAMES[name] ?? name;
}

// FIFA men's world ranking, keyed by the same canonical English names. Snapshot
// from the June 2026 FIFA/Coca-Cola ranking (source: ESPN top-50 + BBC for
// 51+). Rankings move at most monthly and are effectively frozen during the
// tournament, so a static snapshot is a fact, not a live dependency. Refresh by
// hand if a new ranking lands mid-event. Unknown names (knockout placeholders)
// return null via fifaRank() — the prompt then simply omits the strength angle.
const FIFA_RANKING = {
  'Argentina': 1,
  'Spain': 2,
  'France': 3,
  'England': 4,
  'Portugal': 5,
  'Brazil': 6,
  'Morocco': 7,
  'Netherlands': 8,
  'Belgium': 9,
  'Germany': 10,
  'Croatia': 11,
  'Colombia': 13,
  'Mexico': 14,
  'Senegal': 15,
  'Uruguay': 16,
  'United States': 17,
  'Japan': 18,
  'Switzerland': 19,
  'Iran': 20,
  'Turkey': 22,
  'Türkiye': 22,
  'Ecuador': 23,
  'Austria': 24,
  'South Korea': 25,
  'Korea Republic': 25,
  'Australia': 27,
  'Algeria': 28,
  'Egypt': 29,
  'Canada': 30,
  'Norway': 31,
  'Ivory Coast': 33,
  'Panama': 34,
  'Sweden': 38,
  'Czechia': 40,
  'Paraguay': 41,
  'Scotland': 42,
  'Tunisia': 45,
  'Congo DR': 46,
  'DR Congo': 46,
  'Uzbekistan': 50,
  'Qatar': 56,
  'Iraq': 57,
  'South Africa': 60,
  'Saudi Arabia': 61,
  'Jordan': 63,
  'Bosnia-Herzegovina': 64,
  'Bosnia and Herzegovina': 64,
  'Cape Verde Islands': 67,
  'Cape Verde': 67,
  'Ghana': 73,
  'Curaçao': 82,
  'Haiti': 83,
  'New Zealand': 85,
};

// Romanian exonym → canonical English name, so fifaRank() resolves a rank when
// it is handed a Romanian name (e.g. reconstructed facts from a stored digest).
const ENGLISH_BY_ROMANIAN = Object.fromEntries(
  Object.entries(ROMANIAN_NAMES).map(([english, romanian]) => [romanian, english]),
);

/**
 * FIFA world rank for a team. Accepts the canonical English name OR the Romanian
 * exonym (reconstructed facts carry Romanian names). Returns null for
 * unknown/placeholder names so callers can omit the strength angle rather than
 * fabricate one.
 */
export function fifaRank(name) {
  return FIFA_RANKING[name] ?? FIFA_RANKING[ENGLISH_BY_ROMANIAN[name]] ?? null;
}

/**
 * flag-icons codes keyed by the same canonical English names ROMANIAN_NAMES
 * uses. Lowercase ISO 3166-1 alpha-2, except the home nations which use
 * flag-icons sub-national codes (gb-eng, gb-sct). Unknown names (knockout
 * placeholders) return null so the renderer can skip the flag.
 */
const FLAG_CODES = {
  'Algeria': 'dz',
  'Argentina': 'ar',
  'Australia': 'au',
  'Austria': 'at',
  'Belgium': 'be',
  'Bosnia-Herzegovina': 'ba',
  'Brazil': 'br',
  'Canada': 'ca',
  'Cape Verde Islands': 'cv',
  'Colombia': 'co',
  'Congo DR': 'cd',
  'Croatia': 'hr',
  'Curaçao': 'cw',
  'Czechia': 'cz',
  'Ecuador': 'ec',
  'Egypt': 'eg',
  'England': 'gb-eng',
  'France': 'fr',
  'Germany': 'de',
  'Ghana': 'gh',
  'Haiti': 'ht',
  'Iran': 'ir',
  'Iraq': 'iq',
  'Ivory Coast': 'ci',
  'Japan': 'jp',
  'Jordan': 'jo',
  'Mexico': 'mx',
  'Morocco': 'ma',
  'Netherlands': 'nl',
  'New Zealand': 'nz',
  'Norway': 'no',
  'Panama': 'pa',
  'Paraguay': 'py',
  'Portugal': 'pt',
  'Qatar': 'qa',
  'Saudi Arabia': 'sa',
  'Scotland': 'gb-sct',
  'Senegal': 'sn',
  'South Africa': 'za',
  'South Korea': 'kr',
  'Spain': 'es',
  'Sweden': 'se',
  'Switzerland': 'ch',
  'Tunisia': 'tn',
  'Turkey': 'tr',
  'Türkiye': 'tr',
  'Korea Republic': 'kr',
  'Cape Verde': 'cv',
  'DR Congo': 'cd',
  'Bosnia and Herzegovina': 'ba',
  'United States': 'us',
  'Uruguay': 'uy',
  'Uzbekistan': 'uz',
};

export function flagCode(name) {
  return FLAG_CODES[name] ?? null;
}

export function teamNameKeys() {
  return Object.keys(ROMANIAN_NAMES);
}

export function flagCodeKeys() {
  return Object.keys(FLAG_CODES);
}

export function flagCodeValues() {
  return Object.values(FLAG_CODES);
}

/**
 * FIFA tricodes (as they appear in the highlights feed's Country tags) mapped to
 * our flag-icons codes. FIFA tricodes are not ISO-3166 (RSA not ZAF, GER not
 * DEU), so this is a hand-authored table, not a derived one. Covers the 48
 * finalists; the home nations use flag-icons sub-national codes. An unknown
 * tricode returns null, meaning that side cannot confirm a kickoff collision.
 */
const FIFA_TRICODE_TO_FLAG = {
  ALG: 'dz',
  ARG: 'ar',
  AUS: 'au',
  AUT: 'at',
  BEL: 'be',
  BIH: 'ba',
  BRA: 'br',
  CAN: 'ca',
  CPV: 'cv',
  COL: 'co',
  COD: 'cd',
  CRO: 'hr',
  CUW: 'cw',
  CZE: 'cz',
  ECU: 'ec',
  EGY: 'eg',
  ENG: 'gb-eng',
  FRA: 'fr',
  GER: 'de',
  GHA: 'gh',
  HAI: 'ht',
  IRN: 'ir',
  IRQ: 'iq',
  CIV: 'ci',
  JPN: 'jp',
  JOR: 'jo',
  MEX: 'mx',
  MAR: 'ma',
  NED: 'nl',
  NZL: 'nz',
  NOR: 'no',
  PAN: 'pa',
  PAR: 'py',
  POR: 'pt',
  QAT: 'qa',
  KSA: 'sa',
  SCO: 'gb-sct',
  SEN: 'sn',
  RSA: 'za',
  KOR: 'kr',
  ESP: 'es',
  SWE: 'se',
  SUI: 'ch',
  TUN: 'tn',
  TUR: 'tr',
  USA: 'us',
  URU: 'uy',
  UZB: 'uz',
};

export function fifaTricodeToFlag(tricode) {
  return FIFA_TRICODE_TO_FLAG[tricode] ?? null;
}

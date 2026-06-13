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
  'United States': 'SUA',
  'Uruguay': 'Uruguay',
  'Uzbekistan': 'Uzbekistan',
};

export function romanianTeamName(name) {
  return ROMANIAN_NAMES[name] ?? name;
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

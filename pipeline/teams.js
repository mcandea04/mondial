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
 * Spanish exonyms keyed by the Romanian name (the form match facts carry once
 * parsed). Used only to match El Gráfico's Spanish recap titles to a game — not
 * user-facing. Unknown names pass through unchanged.
 */
const SPANISH_NAMES = {
  'Algeria': 'Argelia',
  'Argentina': 'Argentina',
  'Australia': 'Australia',
  'Austria': 'Austria',
  'Belgia': 'Bélgica',
  'Bosnia și Herțegovina': 'Bosnia y Herzegovina',
  'Brazilia': 'Brasil',
  'Canada': 'Canadá',
  'Capul Verde': 'Cabo Verde',
  'Columbia': 'Colombia',
  'RD Congo': 'RD Congo',
  'Croația': 'Croacia',
  'Curaçao': 'Curazao',
  'Cehia': 'República Checa',
  'Ecuador': 'Ecuador',
  'Egipt': 'Egipto',
  'Anglia': 'Inglaterra',
  'Franța': 'Francia',
  'Germania': 'Alemania',
  'Ghana': 'Ghana',
  'Haiti': 'Haití',
  'Iran': 'Irán',
  'Irak': 'Irak',
  'Coasta de Fildeș': 'Costa de Marfil',
  'Japonia': 'Japón',
  'Iordania': 'Jordania',
  'Mexic': 'México',
  'Maroc': 'Marruecos',
  'Olanda': 'Países Bajos',
  'Noua Zeelandă': 'Nueva Zelanda',
  'Norvegia': 'Noruega',
  'Panama': 'Panamá',
  'Paraguay': 'Paraguay',
  'Portugalia': 'Portugal',
  'Qatar': 'Catar',
  'Arabia Saudită': 'Arabia Saudita',
  'Scoția': 'Escocia',
  'Senegal': 'Senegal',
  'Africa de Sud': 'Sudáfrica',
  'Coreea de Sud': 'Corea del Sur',
  'Spania': 'España',
  'Suedia': 'Suecia',
  'Elveția': 'Suiza',
  'Tunisia': 'Túnez',
  'Turcia': 'Turquía',
  'SUA': 'Estados Unidos',
  'Uruguay': 'Uruguay',
  'Uzbekistan': 'Uzbekistán',
};

export function spanishTeamName(name) {
  return SPANISH_NAMES[name] ?? name;
}

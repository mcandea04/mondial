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

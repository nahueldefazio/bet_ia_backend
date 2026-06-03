export interface OddsApiEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}

export interface OddsApiBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsApiMarket[];
}

export interface OddsApiMarket {
  key: string;
  last_update: string;
  outcomes: OddsApiOutcome[];
}

export interface OddsApiOutcome {
  name: string;
  price: number;
  point?: number;
}

export interface NormalizedOdd {
  bookmaker: string;
  market: string;
  outcome: string;
  value: number;
}

export const SPORT_COUNTRY_MAP: Record<string, string> = {
  soccer_epl: 'England',
  soccer_spain_la_liga: 'Spain',
  soccer_italy_serie_a: 'Italy',
  soccer_germany_bundesliga: 'Germany',
  soccer_france_ligue_one: 'France',
};

export const TRACKED_SPORTS_DEFAULT = [
  'soccer_epl',
  'soccer_spain_la_liga',
  'soccer_italy_serie_a',
  'soccer_germany_bundesliga',
  'soccer_france_ligue_one',
];

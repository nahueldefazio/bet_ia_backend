import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  OddsApiEvent,
  OddsApiMarket,
  NormalizedOdd,
  SPORT_COUNTRY_MAP,
  TRACKED_SPORTS_DEFAULT,
} from './sports.types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SportsService {
  private readonly logger = new Logger(SportsService.name);
  private readonly http: AxiosInstance;
  private readonly apiKey: string;
  private readonly trackedSports: string[];

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.apiKey = this.config.getOrThrow('ODDS_API_KEY');
    this.http = axios.create({
      baseURL: 'https://api.the-odds-api.com',
      timeout: 15000,
    });

    const sportsEnv = this.config.get<string>('TRACKED_SPORTS', '');
    this.trackedSports = sportsEnv
      ? sportsEnv.split(',').map((s) => s.trim()).filter(Boolean)
      : TRACKED_SPORTS_DEFAULT;
  }

  async fetchUpcomingFixtures(): Promise<void> {
    const now = new Date();
    const in10days = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);

    for (const sport of this.trackedSports) {
      try {
        const { data, headers } = await this.http.get<OddsApiEvent[]>(
          `/v4/sports/${sport}/odds`,
          {
            params: {
              apiKey: this.apiKey,
              regions: 'eu',
              markets: 'h2h,totals',
              oddsFormat: 'decimal',
              commenceTimeFrom: now.toISOString().split('.')[0] + 'Z',
              commenceTimeTo: in10days.toISOString().split('.')[0] + 'Z',
            },
          },
        );

        const remaining = headers['x-requests-remaining'];
        this.logger.log(
          `Sport ${sport}: ${data.length} events | Credits remaining: ${remaining}`,
        );

        for (const event of data) {
          await this.upsertEventWithOdds(event);
        }
      } catch (err) {
        const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        this.logger.error(`Failed to fetch odds for ${sport}: ${detail}`);
      }
    }
  }

  async getUpcomingMatchesFromDb() {
    const now = new Date();
    const in10days = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
    return this.prisma.match.findMany({
      where: {
        matchDate: { gte: now, lte: in10days },
        status: 'NS',
      },
      include: { odds: true, predictions: true },
      orderBy: { matchDate: 'asc' },
    });
  }

  private async upsertEventWithOdds(event: OddsApiEvent): Promise<void> {
    const country = SPORT_COUNTRY_MAP[event.sport_key] ?? 'Unknown';
    const matchData = {
      homeTeam: event.home_team,
      awayTeam: event.away_team,
      league: event.sport_title,
      country,
      matchDate: new Date(event.commence_time),
      status: 'NS',
    };

    const match = await this.prisma.match.upsert({
      where: { fixtureId: event.id },
      update: matchData,
      create: { fixtureId: event.id, ...matchData },
    });

    const odds = this.normalizeOdds(event);
    if (odds.length) {
      await this.prisma.odd.deleteMany({ where: { matchId: match.id } });
      await this.prisma.odd.createMany({
        data: odds.map((o) => ({ matchId: match.id, ...o })),
      });
    }
  }

  private normalizeOdds(event: OddsApiEvent): NormalizedOdd[] {
    const results: NormalizedOdd[] = [];
    for (const bookmaker of event.bookmakers) {
      for (const market of bookmaker.markets) {
        const normalized = this.normalizeMarket(event, bookmaker.title, market);
        results.push(...normalized);
      }
    }
    return results;
  }

  private normalizeMarket(
    event: OddsApiEvent,
    bookmakerTitle: string,
    market: OddsApiMarket,
  ): NormalizedOdd[] {
    if (market.key === 'h2h') return this.normalizeH2H(event, bookmakerTitle, market);
    if (market.key === 'btts') return this.normalizeBtts(bookmakerTitle, market);
    if (market.key === 'totals') return this.normalizeTotals(bookmakerTitle, market);
    return [];
  }

  private normalizeH2H(
    event: OddsApiEvent,
    bookmakerTitle: string,
    market: OddsApiMarket,
  ): NormalizedOdd[] {
    return market.outcomes.map((outcome) => {
      let normalizedOutcome: string;
      if (outcome.name === event.home_team) normalizedOutcome = 'Home';
      else if (outcome.name === event.away_team) normalizedOutcome = 'Away';
      else normalizedOutcome = 'Draw';
      return { bookmaker: bookmakerTitle, market: '1X2', outcome: normalizedOutcome, value: outcome.price };
    });
  }

  private normalizeBtts(bookmakerTitle: string, market: OddsApiMarket): NormalizedOdd[] {
    return market.outcomes.map((outcome) => ({
      bookmaker: bookmakerTitle,
      market: 'BTTS',
      outcome: outcome.name,
      value: outcome.price,
    }));
  }

  private normalizeTotals(bookmakerTitle: string, market: OddsApiMarket): NormalizedOdd[] {
    return market.outcomes
      .filter((o) => o.point === 2.5)
      .map((outcome) => ({
        bookmaker: bookmakerTitle,
        market: 'OVER_UNDER',
        outcome: outcome.name === 'Over' ? 'OVER_2_5' : 'UNDER_2_5',
        value: outcome.price,
      }));
  }
}

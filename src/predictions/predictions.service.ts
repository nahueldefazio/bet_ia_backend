import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SportsService } from '../sports/sports.service';
import { AiAnalysisService } from './ai-analysis.service';
import { FootballStatsService } from '../football-stats/football-stats.service';
import { EloService } from '../elo/elo.service';
import {
  calcExpectedValue,
  impliedProbability,
  devig,
  confidenceLevel,
  poissonMatchProbabilities,
  eloProbabilities,
} from './ev-calculator';
import { Match, Odd, Prediction } from '@prisma/client';

export type MatchWithOddsAndPredictions = Match & {
  odds: Odd[];
  predictions: Prediction[];
};

export interface ValueBetAlert {
  match: MatchWithOddsAndPredictions;
  predictions: Prediction[];
}


@Injectable()
export class PredictionsService {
  private readonly logger = new Logger(PredictionsService.name);
  private readonly evThreshold: number;
  private readonly minConfidence: string;
  private readonly minOdd: number;
  private readonly maxOdd: number;
  private readonly minBookmakers: number;
  private readonly alertHandlers: ((alerts: ValueBetAlert[]) => void)[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly sports: SportsService,
    private readonly ai: AiAnalysisService,
    private readonly config: ConfigService,
    private readonly footballStats: FootballStatsService,
    private readonly elo: EloService,
  ) {
    this.evThreshold = Number.parseFloat(this.config.get('EV_THRESHOLD', '0.05'));
    this.minConfidence = this.config.get('MIN_CONFIDENCE', 'MEDIUM');
    this.minOdd = Number.parseFloat(this.config.get('MIN_ODD', '1.20'));
    this.maxOdd = Number.parseFloat(this.config.get('MAX_ODD', '10.00'));
    this.minBookmakers = Number.parseInt(this.config.get('MIN_BOOKMAKERS', '3'), 10);
  }

  onAlert(handler: (alerts: ValueBetAlert[]) => void) {
    this.alertHandlers.push(handler);
  }

  @Cron(process.env.FETCH_CRON ?? '0 8 * * *')
  async runFullAnalysisCycle() {
    this.logger.log('Starting full analysis cycle...');
    try {
      await this.sports.fetchUpcomingFixtures();
      const matches = await this.sports.getUpcomingMatchesFromDb();
      this.logger.log(`Analysing ${matches.length} upcoming matches`);

      const newAlerts: ValueBetAlert[] = [];
      for (const match of matches) {
        const preds = await this.analyzeMatch(match);
        if (preds.length) newAlerts.push({ match, predictions: preds });
      }

      if (newAlerts.length) {
        this.logger.log(`Found ${newAlerts.length} value bet opportunities`);
        this.alertHandlers.forEach((h) => h(newAlerts));
      }
    } catch (err) {
      this.logger.error(`Analysis cycle failed: ${err.message}`);
    }
  }

  async analyzeMatch(match: MatchWithOddsAndPredictions): Promise<Prediction[]> {
    if (!match.odds.length) return [];

    await this.prisma.prediction.deleteMany({ where: { matchId: match.id } });

    const [homeStats, awayStats] = await Promise.all([
      this.footballStats.getTeamStats(match.homeTeam),
      this.footballStats.getTeamStats(match.awayTeam),
    ]);

    const markets = this.groupOddsByMarket(match.odds);
    const newPredictions: Prediction[] = [];

    for (const [market, odds] of Object.entries(markets)) {
      const byOutcome: Record<string, number[]> = {};
      for (const o of odds) {
        if (!byOutcome[o.outcome]) byOutcome[o.outcome] = [];
        byOutcome[o.outcome].push(o.value);
      }

      const outcomes = Object.keys(byOutcome);
      if (outcomes.length < 2) continue;

      // Require minimum number of bookmakers for a reliable devig
      const minBooks = Math.min(...outcomes.map((o) => byOutcome[o].length));
      if (minBooks < this.minBookmakers) continue;

      const avgOdds = outcomes.map(
        (o) => byOutcome[o].reduce((a, b) => a + b, 0) / byOutcome[o].length,
      );
      const consensusProbs = devig(avgOdds);

      // World Cup: blend devig with Elo ratings (computed from 150y of international results)
      // Other leagues: blend devig with Poisson when team stats are available
      let blendedProbs: number[] | null = null;
      const isWorldCup = match.league.toLowerCase().includes('world cup');

      if (market === '1X2') {
        if (isWorldCup) {
          const [homeElo, awayElo] = await Promise.all([
            this.elo.getTeamElo(match.homeTeam),
            this.elo.getTeamElo(match.awayTeam),
          ]);
          if (homeElo && awayElo) {
            const ep = eloProbabilities(homeElo.eloRating, awayElo.eloRating);
            const eloMap: Record<string, number> = { Home: ep.home, Away: ep.away, Draw: ep.draw };
            if (outcomes.every((o) => eloMap[o] !== undefined)) {
              blendedProbs = outcomes.map((o, i) => 0.5 * consensusProbs[i] + 0.5 * eloMap[o]);
              this.logger.debug(`Elo blend: ${match.homeTeam}(${homeElo.eloRating}) vs ${match.awayTeam}(${awayElo.eloRating})`);
            }
          }
        } else if (homeStats != null && homeStats.avgGoalsFor > 0 && awayStats != null && awayStats.avgGoalsFor > 0) {
          const p = poissonMatchProbabilities(
            homeStats.avgGoalsFor, homeStats.avgGoalsAgainst,
            awayStats.avgGoalsFor, awayStats.avgGoalsAgainst,
          );
          const poissonMap: Record<string, number> = { Home: p.home, Away: p.away, Draw: p.draw };
          if (outcomes.every((o) => poissonMap[o] !== undefined)) {
            blendedProbs = outcomes.map((o, i) => 0.5 * consensusProbs[i] + 0.5 * poissonMap[o]);
          }
        }
      }

      const finalProbs = blendedProbs ?? consensusProbs;
      const bestByOutcome = this.findBestOdds(odds);

      for (let i = 0; i < outcomes.length; i++) {
        const pred = await this.analyzeOutcome(
          match,
          market,
          outcomes[i],
          bestByOutcome[outcomes[i]],
          finalProbs[i],
        );
        if (pred) newPredictions.push(pred);
      }
    }

    return newPredictions;
  }

  private async analyzeOutcome(
    match: MatchWithOddsAndPredictions,
    market: string,
    outcome: string,
    best: { value: number; bookmaker: string },
    trueProbability: number,
  ): Promise<Prediction | null> {
    if (best.value < this.minOdd || best.value > this.maxOdd) return null;

    const implied = impliedProbability(best.value);
    const ev = calcExpectedValue(trueProbability, best.value);

    if (ev < this.evThreshold) return null;
    const confidence = confidenceLevel(ev, trueProbability);
    if (!this.meetsMinConfidence(confidence)) return null;

    return this.prisma.prediction.create({
      data: {
        matchId: match.id,
        market,
        outcome,
        trueProbability,
        impliedProbability: implied,
        expectedValue: ev,
        bestOdd: best.value,
        bookmaker: best.bookmaker,
        confidence,
        aiAnalysis: null,
        aiModel: null,
      },
    });
  }

  async analyzeOnDemand(predictionId: number) {
    const pred = await this.prisma.prediction.findUnique({
      where: { id: predictionId },
      include: { match: true },
    });
    if (!pred) return null;

    const aiResult = await this.ai.analyzeValueBet({
      homeTeam: pred.match.homeTeam,
      awayTeam: pred.match.awayTeam,
      league: pred.match.league,
      market: pred.market,
      outcome: pred.outcome,
      bestOdd: pred.bestOdd,
      trueProbability: pred.trueProbability,
      impliedProbability: pred.impliedProbability,
      expectedValue: pred.expectedValue,
      homeForm: 'N/A',
      awayForm: 'N/A',
      homeAvgGoals: null,
      awayAvgGoals: null,
    });

    if (!aiResult) return pred;

    return this.prisma.prediction.update({
      where: { id: predictionId },
      data: { aiAnalysis: aiResult.reasoning, aiModel: aiResult.model },
      include: { match: true },
    });
  }

  async getRecentAlerts(limit = 20) {
    return this.prisma.alert.findMany({
      take: limit,
      orderBy: { sentAt: 'desc' },
      include: { match: true, prediction: true },
    });
  }

  async getTopValueBets(limit = 10) {
    const now = new Date();
    const in10days = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
    return this.prisma.prediction.findMany({
      where: {
        match: { matchDate: { gte: now, lte: in10days }, status: 'NS' },
        expectedValue: { gte: this.evThreshold },
      },
      include: { match: true },
      orderBy: { expectedValue: 'desc' },
      take: limit,
    });
  }

  private groupOddsByMarket(odds: Odd[]): Record<string, Odd[]> {
    return odds.reduce(
      (acc, o) => {
        if (!acc[o.market]) acc[o.market] = [];
        acc[o.market].push(o);
        return acc;
      },
      {} as Record<string, Odd[]>,
    );
  }

  private findBestOdds(odds: Odd[]): Record<string, { value: number; bookmaker: string }> {
    const best: Record<string, { value: number; bookmaker: string }> = {};
    for (const o of odds) {
      if (!best[o.outcome] || o.value > best[o.outcome].value) {
        best[o.outcome] = { value: o.value, bookmaker: o.bookmaker };
      }
    }
    return best;
  }

  private meetsMinConfidence(confidence: string): boolean {
    const levels = ['LOW', 'MEDIUM', 'HIGH'];
    return levels.indexOf(confidence) >= levels.indexOf(this.minConfidence);
  }
}

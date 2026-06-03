import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SportsService } from '../sports/sports.service';
import { AiAnalysisService } from './ai-analysis.service';
import {
  calcExpectedValue,
  impliedProbability,
  devig,
  poissonMatchProbabilities,
  confidenceLevel,
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

const POISSON_HOME_AVG = 1.4;
const POISSON_HOME_CONCEDED = 1.2;
const POISSON_AWAY_AVG = 1.1;
const POISSON_AWAY_CONCEDED = 1.3;

@Injectable()
export class PredictionsService {
  private readonly logger = new Logger(PredictionsService.name);
  private readonly evThreshold: number;
  private readonly minConfidence: string;
  private readonly alertHandlers: ((alerts: ValueBetAlert[]) => void)[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly sports: SportsService,
    private readonly ai: AiAnalysisService,
    private readonly config: ConfigService,
  ) {
    this.evThreshold = Number.parseFloat(this.config.get('EV_THRESHOLD', '0.05'));
    this.minConfidence = this.config.get('MIN_CONFIDENCE', 'MEDIUM');
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

    const probs = poissonMatchProbabilities(
      POISSON_HOME_AVG,
      POISSON_HOME_CONCEDED,
      POISSON_AWAY_AVG,
      POISSON_AWAY_CONCEDED,
    );
    const probabilityMap: Record<string, number> = {
      Home: probs.home,
      Draw: probs.draw,
      Away: probs.away,
      Yes: probs.btts,
      No: 1 - probs.btts,
      OVER_2_5: probs.over25,
      UNDER_2_5: 1 - probs.over25,
    };

    const markets = this.groupOddsByMarket(match.odds);
    const newPredictions: Prediction[] = [];

    for (const [market, odds] of Object.entries(markets)) {
      const bestByOutcome = this.findBestOdds(odds);
      const noVigProbs = devig(Object.values(bestByOutcome).map((o) => o.value));
      const outcomes = Object.keys(bestByOutcome);

      for (let i = 0; i < outcomes.length; i++) {
        const pred = await this.analyzeOutcome(
          match,
          market,
          outcomes[i],
          bestByOutcome[outcomes[i]],
          probabilityMap[outcomes[i]] ?? noVigProbs[i],
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
    const implied = impliedProbability(best.value);
    const ev = calcExpectedValue(trueProbability, best.value);

    if (ev < this.evThreshold) return null;
    const confidence = confidenceLevel(ev, trueProbability);
    if (!this.meetsMinConfidence(confidence)) return null;

    const predData = {
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
    };

    const existing = await this.prisma.prediction.findFirst({
      where: { matchId: match.id, market, outcome },
    });

    return existing
      ? this.prisma.prediction.update({ where: { id: existing.id }, data: predData })
      : this.prisma.prediction.create({ data: predData });
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
      homeAvgGoals: POISSON_HOME_AVG,
      awayAvgGoals: POISSON_AWAY_AVG,
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

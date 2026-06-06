import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';

// K-factor por tipo de competencia — mayor peso a partidos más importantes
const K_BY_TOURNAMENT: Array<[string, number]> = [
  ['FIFA World Cup', 60],
  ['World Cup', 60],
  ['UEFA Euro', 55],
  ['Copa América', 55],
  ['Africa Cup of Nations', 50],
  ['AFC Asian Cup', 50],
  ['CONCACAF Gold Cup', 45],
  ['qualification', 40],
  ['Qualifying', 40],
  ['Nations League', 35],
  ['Friendly', 20],
];

// Nombres distintos entre el CSV y The Odds API
const NAME_ALIASES: Record<string, string> = {
  'United States': 'United States',
  'Korea Republic': 'South Korea',
  'Korea DPR': 'North Korea',
  'Iran': 'IR Iran',
  'Ivory Coast': "Côte d'Ivoire",
  "Cote d'Ivoire": "Côte d'Ivoire",
  'Cape Verde': 'Cape Verde Islands',
  'DR Congo': 'Congo DR',
  'Trinidad and Tobago': 'Trinidad & Tobago',
  'Bosnia-Herzegovina': 'Bosnia & Herzegovina',
};

const RESULTS_CSV_URL =
  'https://raw.githubusercontent.com/martj42/international_results/master/results.csv';

@Injectable()
export class EloService {
  private readonly logger = new Logger(EloService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Weekly sync — ratings change slowly, daily would waste bandwidth
  @Cron('0 10 * * 1')
  async syncEloRatings() {
    this.logger.log('Starting Elo ratings sync from international results CSV...');
    try {
      const { data } = await axios.get<string>(RESULTS_CSV_URL, { timeout: 30_000 });
      const ratings = this.computeElo(data);
      await this.saveRatings(ratings);
      this.logger.log(`Elo ratings saved for ${Object.keys(ratings).length} national teams`);
    } catch (err) {
      this.logger.error(`Elo sync failed: ${err.message}`);
    }
  }

  private computeElo(csv: string): Record<string, number> {
    const lines = csv.trim().split('\n');
    const ratings: Record<string, number> = {};

    // CSV columns: date,home_team,away_team,home_score,away_score,tournament,city,country,neutral
    for (let i = 1; i < lines.length; i++) {
      const cols = this.parseLine(lines[i]);
      if (cols.length < 6) continue;

      const [, homeRaw, awayRaw, hsStr, asStr, tournament] = cols;
      const homeTeam = NAME_ALIASES[homeRaw] ?? homeRaw;
      const awayTeam = NAME_ALIASES[awayRaw] ?? awayRaw;
      const hs = parseInt(hsStr, 10);
      const as_ = parseInt(asStr, 10);

      if (isNaN(hs) || isNaN(as_)) continue;

      if (ratings[homeTeam] === undefined) ratings[homeTeam] = 1500;
      if (ratings[awayTeam] === undefined) ratings[awayTeam] = 1500;

      const k = this.kFactor(tournament);
      const expected = 1 / (1 + Math.pow(10, (ratings[awayTeam] - ratings[homeTeam]) / 400));
      const result = hs > as_ ? 1 : hs === as_ ? 0.5 : 0;
      const delta = k * (result - expected);

      ratings[homeTeam] += delta;
      ratings[awayTeam] -= delta;
    }

    return ratings;
  }

  private kFactor(tournament: string): number {
    for (const [keyword, k] of K_BY_TOURNAMENT) {
      if (tournament.includes(keyword)) return k;
    }
    return 30;
  }

  private parseLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === ',' && !inQuotes) { result.push(current); current = ''; }
      else { current += ch; }
    }
    result.push(current);
    return result;
  }

  private async saveRatings(ratings: Record<string, number>) {
    for (const [teamName, eloRating] of Object.entries(ratings)) {
      await this.prisma.nationalTeamElo.upsert({
        where: { teamName },
        create: { teamName, eloRating: Math.round(eloRating) },
        update: { eloRating: Math.round(eloRating) },
      });
    }
  }

  async getTeamElo(teamName: string) {
    const direct = await this.prisma.nationalTeamElo.findUnique({ where: { teamName } });
    if (direct) return direct;

    // Fallback: first word match (handles "Bosnia & Herzegovina" vs "Bosnia-Herzegovina")
    const firstWord = teamName.split(' ')[0].split('&')[0].trim();
    return this.prisma.nationalTeamElo.findFirst({
      where: { teamName: { contains: firstWord } },
    });
  }
}

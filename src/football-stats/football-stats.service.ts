import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import axios, { AxiosInstance } from 'axios';
import { PrismaService } from '../prisma/prisma.service';

// Maps The Odds API sport keys → API-Football league IDs + last available season on free plan
// Note: soccer_fifa_world_cup excluded — free plan caps at 2024, 2022 data too stale to be useful
const SPORT_TO_LEAGUE: Record<string, { leagueId: number; season: number }> = {
  soccer_epl: { leagueId: 39, season: 2024 },
  soccer_spain_la_liga: { leagueId: 140, season: 2024 },
  soccer_italy_serie_a: { leagueId: 135, season: 2024 },
  soccer_germany_bundesliga: { leagueId: 78, season: 2024 },
  soccer_france_ligue_one: { leagueId: 61, season: 2024 },
  soccer_conmebol_copa_libertadores: { leagueId: 13, season: 2024 },
  soccer_conmebol_copa_sudamericana: { leagueId: 11, season: 2024 },
  soccer_brazil_serie_b: { leagueId: 72, season: 2024 },
};

@Injectable()
export class FootballStatsService {
  private readonly logger = new Logger(FootballStatsService.name);
  private readonly http: AxiosInstance;
  private readonly apiKey: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.apiKey = this.config.get('FOOTBALL_API_KEY', '');
    this.http = axios.create({
      baseURL: 'https://v3.football.api-sports.io',
      timeout: 15000,
      headers: { 'x-apisports-key': this.apiKey },
    });
  }

  // Runs weekly on Monday at 9am — team stats don't change daily
  @Cron('0 9 * * 1')
  async syncAllTeamStats() {
    if (!this.apiKey) {
      this.logger.warn('FOOTBALL_API_KEY not set — skipping team stats sync');
      return;
    }

    const sportsEnv = this.config.get<string>('TRACKED_SPORTS', '');
    const trackedSports = sportsEnv.split(',').map((s) => s.trim()).filter(Boolean);

    for (const sport of trackedSports) {
      const leagueInfo = SPORT_TO_LEAGUE[sport];
      if (!leagueInfo) continue;

      try {
        await this.syncLeague(leagueInfo.leagueId, leagueInfo.season);
      } catch (err) {
        this.logger.error(`Failed to sync stats for ${sport}: ${err.message}`);
      }
    }
  }

  private async syncLeague(leagueId: number, season: number) {
    const { data } = await this.http.get('/standings', {
      params: { league: leagueId, season },
    });

    const groups: unknown[][] = data?.response?.[0]?.league?.standings ?? [];
    const standings = groups.flat() as Array<{
      team: { id: number; name: string };
      all: { played: number; win: number; draw: number; lose: number; goals: { for: number; against: number } };
      form: string;
    }>;

    if (!standings.length) {
      this.logger.warn(`No standings found for league ${leagueId} season ${season}`);
      return;
    }

    for (const row of standings) {
      const { team, all: stats, form } = row;
      if (!team?.name || !stats) continue;

      const avgFor = stats.played > 0 ? stats.goals.for / stats.played : 0;
      const avgAgainst = stats.played > 0 ? stats.goals.against / stats.played : 0;

      await this.prisma.teamStats.upsert({
        where: { teamId_leagueId_season: { teamId: team.id, leagueId, season: String(season) } },
        create: {
          teamId: team.id,
          teamName: team.name,
          leagueId,
          season: String(season),
          played: stats.played,
          wins: stats.win,
          draws: stats.draw,
          losses: stats.lose,
          goalsFor: stats.goals.for,
          goalsAgainst: stats.goals.against,
          avgGoalsFor: avgFor,
          avgGoalsAgainst: avgAgainst,
          formString: form ?? '',
        },
        update: {
          teamName: team.name,
          played: stats.played,
          wins: stats.win,
          draws: stats.draw,
          losses: stats.lose,
          goalsFor: stats.goals.for,
          goalsAgainst: stats.goals.against,
          avgGoalsFor: avgFor,
          avgGoalsAgainst: avgAgainst,
          formString: form ?? '',
        },
      });
    }

    this.logger.log(`Synced ${standings.length} teams for league ${leagueId}`);
  }

  async getTeamStats(teamName: string) {
    // Exact match first (case-insensitive via MySQL collation)
    const exact = await this.prisma.teamStats.findFirst({
      where: { teamName },
      orderBy: { updatedAt: 'desc' },
    });
    if (exact) return exact;

    // Partial match on first word of the team name (handles "Man United" vs "Manchester United")
    const firstWord = teamName.split(' ')[0];
    return this.prisma.teamStats.findFirst({
      where: { teamName: { contains: firstWord } },
      orderBy: { updatedAt: 'desc' },
    });
  }
}

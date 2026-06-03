import { Controller, Get, Post, Param, Query, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { PredictionsService } from '../predictions/predictions.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('api')
export class DashboardController {
  constructor(
    private readonly predictions: PredictionsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('value-bets')
  async getValueBets(@Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number) {
    return this.predictions.getTopValueBets(limit);
  }

  @Get('alerts')
  async getAlerts(@Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number) {
    return this.predictions.getRecentAlerts(limit);
  }

  @Get('matches')
  async getUpcomingMatches() {
    return this.prisma.match.findMany({
      where: {
        matchDate: { gte: new Date() },
        status: 'NS',
      },
      include: {
        predictions: { orderBy: { expectedValue: 'desc' } },
        odds: false,
      },
      orderBy: { matchDate: 'asc' },
      take: 50,
    });
  }

  @Post('sync')
  async triggerSync() {
    void this.predictions.runFullAnalysisCycle();
    return { message: 'Sync started' };
  }

  @Post('analyze/:id')
  async analyzeOnDemand(@Param('id', ParseIntPipe) id: number) {
    return this.predictions.analyzeOnDemand(id);
  }

  @Get('stats')
  async getStats() {
    const [totalMatches, totalPredictions, totalAlerts, topBets] = await Promise.all([
      this.prisma.match.count(),
      this.prisma.prediction.count(),
      this.prisma.alert.count(),
      this.predictions.getTopValueBets(5),
    ]);

    return { totalMatches, totalPredictions, totalAlerts, topBets };
  }
}

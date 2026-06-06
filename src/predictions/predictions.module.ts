import { Module } from '@nestjs/common';
import { SportsModule } from '../sports/sports.module';
import { FootballStatsModule } from '../football-stats/football-stats.module';
import { EloModule } from '../elo/elo.module';
import { PredictionsService } from './predictions.service';
import { AiAnalysisService } from './ai-analysis.service';

@Module({
  imports: [SportsModule, FootballStatsModule, EloModule],
  providers: [PredictionsService, AiAnalysisService],
  exports: [PredictionsService],
})
export class PredictionsModule {}

import { Module } from '@nestjs/common';
import { SportsModule } from '../sports/sports.module';
import { PredictionsService } from './predictions.service';
import { AiAnalysisService } from './ai-analysis.service';

@Module({
  imports: [SportsModule],
  providers: [PredictionsService, AiAnalysisService],
  exports: [PredictionsService],
})
export class PredictionsModule {}

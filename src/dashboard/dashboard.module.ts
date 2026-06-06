import { Module } from '@nestjs/common';
import { PredictionsModule } from '../predictions/predictions.module';
import { EloModule } from '../elo/elo.module';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [PredictionsModule, EloModule],
  controllers: [DashboardController],
})
export class DashboardModule {}

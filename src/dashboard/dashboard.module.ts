import { Module } from '@nestjs/common';
import { PredictionsModule } from '../predictions/predictions.module';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [PredictionsModule],
  controllers: [DashboardController],
})
export class DashboardModule {}

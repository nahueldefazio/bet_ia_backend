import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { PredictionsModule } from '../predictions/predictions.module';
import { EloModule } from '../elo/elo.module';

@Module({
  imports: [PredictionsModule, EloModule],
  controllers: [AdminController],
  providers: [AdminGuard],
})
export class AdminModule {}

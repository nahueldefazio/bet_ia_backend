import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { PredictionsModule } from '../predictions/predictions.module';

@Module({
  imports: [PredictionsModule],
  controllers: [AdminController],
  providers: [AdminGuard],
})
export class AdminModule {}

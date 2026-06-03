import { Module } from '@nestjs/common';
import { PredictionsModule } from '../predictions/predictions.module';
import { TelegramService } from './telegram.service';

@Module({
  imports: [PredictionsModule],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}

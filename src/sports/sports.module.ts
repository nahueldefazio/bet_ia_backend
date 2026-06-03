import { Module } from '@nestjs/common';
import { SportsService } from './sports.service';

@Module({
  providers: [SportsService],
  exports: [SportsService],
})
export class SportsModule {}

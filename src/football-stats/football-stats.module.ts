import { Module } from '@nestjs/common';
import { FootballStatsService } from './football-stats.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [FootballStatsService],
  exports: [FootballStatsService],
})
export class FootballStatsModule {}

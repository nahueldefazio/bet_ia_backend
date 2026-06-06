import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { SportsModule } from './sports/sports.module';
import { PredictionsModule } from './predictions/predictions.module';
import { FootballStatsModule } from './football-stats/football-stats.module';
import { EloModule } from './elo/elo.module';
import { TelegramModule } from './telegram/telegram.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    SportsModule,
    FootballStatsModule,
    EloModule,
    PredictionsModule,
    TelegramModule,
    DashboardModule,
    AdminModule,
  ],
})
export class AppModule {}

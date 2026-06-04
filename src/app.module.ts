import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { SportsModule } from './sports/sports.module';
import { PredictionsModule } from './predictions/predictions.module';
import { TelegramModule } from './telegram/telegram.module';
import { DashboardModule } from './dashboard/dashboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    SportsModule,
    PredictionsModule,
    TelegramModule,
    DashboardModule,
  ],
})
export class AppModule {}

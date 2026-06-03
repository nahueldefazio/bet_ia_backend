import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';
import { PrismaModule } from './prisma/prisma.module';
import { SportsModule } from './sports/sports.module';
import { PredictionsModule } from './predictions/predictions.module';
import { TelegramModule } from './telegram/telegram.module';
import { DashboardModule } from './dashboard/dashboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      // Serve Angular SPA at root; fall through to index.html for all non-API routes
      exclude: ['/api/(.*)'],
    }),
    PrismaModule,
    SportsModule,
    PredictionsModule,
    TelegramModule,
    DashboardModule,
  ],
})
export class AppModule {}

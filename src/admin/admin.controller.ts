import { Controller, Post, UseGuards, HttpCode } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { PredictionsService } from '../predictions/predictions.service';
import { EloService } from '../elo/elo.service';

@Controller('api/admin')
export class AdminController {
  constructor(
    private readonly predictions: PredictionsService,
    private readonly elo: EloService,
  ) {}

  @Post('login')
  @UseGuards(AdminGuard)
  @HttpCode(200)
  login() {
    return { ok: true };
  }

  @Post('sync')
  @UseGuards(AdminGuard)
  @HttpCode(200)
  sync() {
    void this.predictions.runFullAnalysisCycle();
    return { message: 'Sync iniciado' };
  }

  @Post('sync-elo')
  @UseGuards(AdminGuard)
  @HttpCode(200)
  syncElo() {
    void this.elo.syncEloRatings();
    return { message: 'Elo sync iniciado' };
  }
}

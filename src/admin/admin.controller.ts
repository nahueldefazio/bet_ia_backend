import { Controller, Post, UseGuards, HttpCode } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { PredictionsService } from '../predictions/predictions.service';

@Controller('api/admin')
export class AdminController {
  constructor(private readonly predictions: PredictionsService) {}

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
}

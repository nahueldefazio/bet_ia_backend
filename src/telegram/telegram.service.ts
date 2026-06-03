import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Context } from 'telegraf';
import { PredictionsService, ValueBetAlert } from '../predictions/predictions.service';
import { PrismaService } from '../prisma/prisma.service';
import { Prediction } from '@prisma/client';

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Telegraf;
  private allowedChatIds: Set<string>;

  constructor(
    private readonly config: ConfigService,
    private readonly predictions: PredictionsService,
    private readonly prisma: PrismaService,
  ) {
    const token = this.config.getOrThrow<string>('TELEGRAM_BOT_TOKEN');
    const allowed = this.config.get<string>('TELEGRAM_ALLOWED_CHAT_IDS', '');
    this.allowedChatIds = new Set(allowed.split(',').map((s) => s.trim()).filter(Boolean));
    this.bot = new Telegraf(token);
  }

  async onModuleInit() {
    this.registerCommands();

    this.predictions.onAlert((alerts) => this.broadcastAlerts(alerts));

    this.bot.launch().catch((err) => {
      this.logger.error(`Telegram bot launch failed: ${err.message}`);
    });

    this.logger.log('Telegram bot started');
  }

  async onModuleDestroy() {
    this.bot.stop('SIGTERM');
  }

  private registerCommands() {
    this.bot.command('start', (ctx) => this.handleStart(ctx));
    this.bot.command('worthbets', (ctx) => this.handleWorthBets(ctx));
    this.bot.command('analizar', (ctx) => this.handleAnalizar(ctx));
    this.bot.command('historial', (ctx) => this.handleHistorial(ctx));
    this.bot.command('ayuda', (ctx) => this.handleHelp(ctx));

    this.bot.on('text', (ctx) => {
      if (this.isAllowed(ctx)) {
        ctx.reply('Usa /ayuda para ver los comandos disponibles.');
      }
    });
  }

  private isAllowed(ctx: Context): boolean {
    const chatId = String(ctx.chat?.id);
    if (this.allowedChatIds.size === 0) return true;
    if (!this.allowedChatIds.has(chatId)) {
      ctx.reply('⛔ No tienes acceso a este bot.');
      return false;
    }
    return true;
  }

  private async handleStart(ctx: Context) {
    if (!this.isAllowed(ctx)) return;
    await ctx.reply(
      `👋 *Bienvenido al Value Betting Bot*\n\n` +
        `Este bot analiza cuotas de fútbol para encontrar apuestas con valor positivo (+EV).\n\n` +
        `📋 Comandos disponibles:\n` +
        `/worthbets — Ver las mejores apuestas +EV ahora\n` +
        `/analizar <equipo> — Analizar partidos de un equipo\n` +
        `/historial — Ver historial de alertas enviadas\n` +
        `/ayuda — Mostrar esta ayuda`,
      { parse_mode: 'Markdown' },
    );
  }

  private async handleWorthBets(ctx: Context) {
    if (!this.isAllowed(ctx)) return;
    await ctx.sendChatAction('typing');

    try {
      const bets = await this.predictions.getTopValueBets(10);
      if (!bets.length) {
        return ctx.reply('🔍 No hay apuestas +EV disponibles en las próximas 48 horas.');
      }

      const lines = bets.map((p, i) => this.formatPrediction(p, i + 1));
      await ctx.reply(
        `🎯 *Top Apuestas +EV (próximas 48h)*\n\n${lines.join('\n\n')}`,
        { parse_mode: 'Markdown' },
      );
    } catch (err) {
      this.logger.error(`handleWorthBets error: ${err.message}`);
      await ctx.reply('❌ Error al obtener las apuestas. Intenta más tarde.');
    }
  }

  private async handleAnalizar(ctx: Context) {
    if (!this.isAllowed(ctx)) return;

    const text = (ctx.message as any)?.text ?? '';
    const query = text.replace('/analizar', '').trim();

    if (!query) {
      return ctx.reply('Uso: /analizar <nombre del equipo>\nEjemplo: /analizar Real Madrid');
    }

    await ctx.sendChatAction('typing');

    try {
      const matches = await this.prisma.match.findMany({
        where: {
          OR: [
            { homeTeam: { contains: query } },
            { awayTeam: { contains: query } },
          ],
          matchDate: { gte: new Date() },
          status: 'NS',
        },
        include: { predictions: true, odds: true },
        take: 5,
        orderBy: { matchDate: 'asc' },
      });

      if (!matches.length) {
        return ctx.reply(`🔍 No encontré partidos próximos para "${query}".`);
      }

      const parts: string[] = [`📊 *Partidos de "${query}"*\n`];

      for (const match of matches) {
        const date = match.matchDate.toLocaleDateString('es-AR', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        });
        parts.push(`⚽ *${match.homeTeam} vs ${match.awayTeam}*`);
        parts.push(`📅 ${date} | ${match.league}`);

        if (match.predictions.length) {
          const top = match.predictions.sort((a, b) => b.expectedValue - a.expectedValue)[0];
          parts.push(
            `✅ Mejor valor: ${top.outcome} @${top.bestOdd.toFixed(2)} EV: +${(top.expectedValue * 100).toFixed(1)}%`,
          );
        } else {
          parts.push(`⏳ Sin análisis aún`);
        }
        parts.push('');
      }

      await ctx.reply(parts.join('\n'), { parse_mode: 'Markdown' });
    } catch (err) {
      this.logger.error(`handleAnalizar error: ${err.message}`);
      await ctx.reply('❌ Error al analizar. Intenta más tarde.');
    }
  }

  private async handleHistorial(ctx: Context) {
    if (!this.isAllowed(ctx)) return;
    await ctx.sendChatAction('typing');

    try {
      const alerts = await this.predictions.getRecentAlerts(10);
      if (!alerts.length) {
        return ctx.reply('📭 No hay historial de alertas aún.');
      }

      const lines = alerts.map((a) => {
        const date = a.sentAt.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
        const result =
          a.match.homeGoals !== null
            ? `${a.match.homeGoals}-${a.match.awayGoals}`
            : 'Pendiente';
        return (
          `📌 ${a.match.homeTeam} vs ${a.match.awayTeam} [${date}]\n` +
          `   ${a.prediction.market} → ${a.prediction.outcome} @${a.prediction.bestOdd.toFixed(2)} | Resultado: ${result}`
        );
      });

      await ctx.reply(
        `📋 *Historial de Alertas*\n\n${lines.join('\n\n')}`,
        { parse_mode: 'Markdown' },
      );
    } catch (err) {
      this.logger.error(`handleHistorial error: ${err.message}`);
      await ctx.reply('❌ Error al cargar historial.');
    }
  }

  private async handleHelp(ctx: Context) {
    if (!this.isAllowed(ctx)) return;
    await ctx.reply(
      `📖 *Comandos del Bot*\n\n` +
        `/worthbets — Top apuestas con valor positivo en las próximas 48h\n` +
        `/analizar <equipo> — Busca partidos y análisis de un equipo específico\n` +
        `/historial — Últimas 10 alertas enviadas con resultado si ya jugaron\n` +
        `/ayuda — Muestra este mensaje`,
      { parse_mode: 'Markdown' },
    );
  }

  async broadcastAlerts(alerts: ValueBetAlert[]) {
    if (!this.allowedChatIds.size) {
      this.logger.warn('No chat IDs configured — skipping broadcast');
      return;
    }

    for (const alert of alerts) {
      const { match, predictions } = alert;
      if (!predictions.length) continue;

      const lines = predictions.map((p, i) => this.formatPrediction(p, i + 1));
      const text =
        `🚨 *ALERTA DE VALOR* — ${match.homeTeam} vs ${match.awayTeam}\n` +
        `🏆 ${match.league} | ` +
        `📅 ${match.matchDate.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}\n\n` +
        lines.join('\n\n');

      for (const chatId of this.allowedChatIds) {
        try {
          const msg = await this.bot.telegram.sendMessage(chatId, text, {
            parse_mode: 'Markdown',
          });

          for (const pred of predictions) {
            await this.prisma.alert.create({
              data: {
                matchId: match.id,
                predictionId: pred.id,
                chatId,
                telegramMsgId: msg.message_id,
              },
            });
          }
        } catch (err) {
          this.logger.error(`Failed to send alert to ${chatId}: ${err.message}`);
        }
      }
    }
  }

  private formatPrediction(p: Prediction & { match?: any }, index: number): string {
    const confidenceEmoji = { HIGH: '🟢', MEDIUM: '🟡', LOW: '🔴' }[p.confidence] ?? '⚪';
    const matchInfo = p.match ? `*${p.match.homeTeam} vs ${p.match.awayTeam}*\n` : '';

    return (
      `${index}. ${matchInfo}` +
      `📊 ${p.market}: *${p.outcome}*\n` +
      `💰 Cuota: ${p.bestOdd.toFixed(2)} (${p.bookmaker})\n` +
      `📈 EV: +${(p.expectedValue * 100).toFixed(2)}% | P. Real: ${(p.trueProbability * 100).toFixed(1)}%\n` +
      `${confidenceEmoji} Confianza: ${p.confidence}` +
      (p.aiAnalysis ? `\n🤖 _${p.aiAnalysis.slice(0, 120)}..._` : '')
    );
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    await this.bot.telegram.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  }
}

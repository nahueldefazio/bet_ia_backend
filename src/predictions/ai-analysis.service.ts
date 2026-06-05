import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export interface MatchContext {
  homeTeam: string;
  awayTeam: string;
  league: string;
  market: string;
  outcome: string;
  bestOdd: number;
  trueProbability: number;
  impliedProbability: number;
  expectedValue: number;
  homeForm: string;
  awayForm: string;
  homeAvgGoals: number | null;
  awayAvgGoals: number | null;
}

export interface AiAnalysisResult {
  reasoning: string;
  model: string;
  adjustedProbability?: number;
}

@Injectable()
export class AiAnalysisService {
  private readonly logger = new Logger(AiAnalysisService.name);
  private readonly provider: string;
  private readonly anthropic?: Anthropic;
  private readonly openai?: OpenAI;

  constructor(private readonly config: ConfigService) {
    this.provider = this.config.get<string>('AI_PROVIDER', 'anthropic').toLowerCase();

    if (this.provider === 'anthropic') {
      const key = this.config.get<string>('ANTHROPIC_API_KEY');
      if (key) this.anthropic = new Anthropic({ apiKey: key });
    } else {
      const key = this.config.get<string>('OPENAI_API_KEY');
      if (key) this.openai = new OpenAI({ apiKey: key });
    }
  }

  async analyzeValueBet(ctx: MatchContext): Promise<AiAnalysisResult | null> {
    if (!this.anthropic && !this.openai) {
      this.logger.warn('No AI provider configured, skipping AI analysis');
      return null;
    }

    const prompt = this.buildPrompt(ctx);

    try {
      if (this.provider === 'anthropic' && this.anthropic) {
        return await this.callAnthropic(prompt);
      } else if (this.openai) {
        return await this.callOpenAI(prompt);
      }
    } catch (err) {
      this.logger.error(`AI analysis failed: ${err.message}`);
    }
    return null;
  }

  private buildPrompt(ctx: MatchContext): string {
    return `Sos un analista profesional de apuestas deportivas especializado en value betting (+EV).

Partido: ${ctx.homeTeam} vs ${ctx.awayTeam} (${ctx.league})
Mercado: ${ctx.market} | Resultado: ${ctx.outcome}
Mejor cuota: ${ctx.bestOdd.toFixed(2)} (Prob. implícita: ${(ctx.impliedProbability * 100).toFixed(1)}%)
Probabilidad de nuestro modelo: ${(ctx.trueProbability * 100).toFixed(1)}%
Valor Esperado (EV): ${(ctx.expectedValue * 100).toFixed(2)}%

Stats de equipos:
- ${ctx.homeTeam}: Forma ${ctx.homeForm}${ctx.homeAvgGoals == null ? '' : `, Promedio ${ctx.homeAvgGoals.toFixed(2)} goles/partido`}
- ${ctx.awayTeam}: Forma ${ctx.awayForm}${ctx.awayAvgGoals == null ? '' : `, Promedio ${ctx.awayAvgGoals.toFixed(2)} goles/partido`}

Tu tarea:
1. Validá si esta es una apuesta de valor genuina basándote en la evidencia estadística
2. Identificá factores clave que puedan afectar el resultado (ventaja de local, forma reciente, contexto del torneo)
3. Dá una evaluación de riesgo breve (máx 2 oraciones)
4. Si no estás de acuerdo con nuestra estimación de probabilidad, sugerí una probabilidad ajustada

Respondé en formato JSON en español:
{
  "reasoning": "Tu análisis conciso (máx 150 palabras)",
  "risk_level": "BAJO|MEDIO|ALTO",
  "adjusted_probability": null o un número 0-1 si no estás de acuerdo con nuestra estimación,
  "recommendation": "APOSTAR|DESCARTAR|MONITOREAR"
}`;
  }

  private async callAnthropic(prompt: string): Promise<AiAnalysisResult> {
    const response = await this.anthropic!.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = (response.content[0] as { type: string; text: string }).text;
    const parsed = this.parseJsonResponse(text);

    return {
      reasoning: parsed?.reasoning ?? text,
      model: 'claude-sonnet-4-6',
      adjustedProbability: parsed?.adjusted_probability ?? undefined,
    };
  }

  private async callOpenAI(prompt: string): Promise<AiAnalysisResult> {
    const response = await this.openai!.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.choices[0]?.message?.content ?? '{}';
    const parsed = this.parseJsonResponse(text);

    return {
      reasoning: parsed?.reasoning ?? text,
      model: 'gpt-4o-mini',
      adjustedProbability: parsed?.adjusted_probability ?? undefined,
    };
  }

  private parseJsonResponse(text: string): Record<string, any> | null {
    try {
      const jsonMatch = /\{[\s\S]*\}/.exec(text);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch {
      // fallthrough
    }
    return null;
  }
}

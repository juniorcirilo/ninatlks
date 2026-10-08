import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BridgeError, type BridgeResult } from './opencode-bridge.service';

export type UsageKind = 'reply' | 'skill_gen' | 'test';

/** Registra o consumo de cada chamada ao agente (alimenta o dashboard). */
@Injectable()
export class UsageLogService {
  private readonly logger = new Logger(UsageLogService.name);

  constructor(private readonly dataSource: DataSource) {}

  private async insert(args: {
    accountId: string;
    conversationId?: string | null;
    personaId?: string | null;
    kind: UsageKind;
    provider: 'llm' | 'legacy';
    model: string | null;
    ok: boolean;
    fallbackCount: number;
    tokens?: {
      input: number;
      output: number;
      reasoning: number;
      cache: number;
    };
    cost?: number;
    durationMs: number;
    error?: string | null;
  }): Promise<void> {
    try {
      await this.dataSource.query(
        `SELECT public.ai_agent_log_usage($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          args.accountId,
          args.conversationId ?? null,
          args.personaId ?? null,
          args.kind,
          args.provider,
          args.model,
          args.ok,
          args.fallbackCount,
          args.tokens?.input ?? 0,
          args.tokens?.output ?? 0,
          args.tokens?.reasoning ?? 0,
          args.tokens?.cache ?? 0,
          args.cost ?? 0,
          args.durationMs,
          args.error ?? null,
        ],
      );
    } catch (err) {
      // 42883 = migration AiAgentUsage pendente: o uso só não é contabilizado.
      if ((err as { code?: string }).code !== '42883')
        this.logger.warn(
          `usage log: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
  }

  /** Chamada ao motor de IA que respondeu. */
  success(
    base: {
      accountId: string;
      conversationId?: string | null;
      personaId?: string | null;
      kind: UsageKind;
    },
    r: BridgeResult,
  ): Promise<void> {
    return this.insert({
      ...base,
      provider: 'llm',
      model: r.model,
      ok: true,
      fallbackCount: r.failures.length,
      tokens: {
        input: r.usage.input,
        output: r.usage.output,
        reasoning: r.usage.reasoning,
        cache: r.usage.cacheRead + r.usage.cacheWrite,
      },
      cost: r.usage.cost,
      durationMs: r.durationMs,
    });
  }

  /** Chamada ao motor de IA em que todos os modelos falharam. */
  failure(
    base: {
      accountId: string;
      conversationId?: string | null;
      personaId?: string | null;
      kind: UsageKind;
    },
    err: unknown,
    models: string[],
  ): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    return this.insert({
      ...base,
      provider: 'llm',
      model: models[0] ?? null,
      ok: false,
      fallbackCount: err instanceof BridgeError ? err.failures.length : 0,
      durationMs: err instanceof BridgeError ? err.durationMs : 0,
      error: message,
    });
  }

  /** Resposta dada pelo provedor antigo (fallback final). */
  legacy(
    base: {
      accountId: string;
      conversationId?: string | null;
      personaId?: string | null;
    },
    ok: boolean,
    durationMs: number,
    error?: string,
  ): Promise<void> {
    return this.insert({
      ...base,
      kind: 'reply',
      provider: 'legacy',
      model: null,
      ok,
      fallbackCount: 0,
      durationMs,
      error,
    });
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { lovableChatCompletion } from './lovable-ai.util';

type Sentiment = 'positive' | 'neutral' | 'negative';

interface PerTurn {
  index: number;
  role: string;
  sentiment: Sentiment;
  score: number;
}

interface SentimentReport {
  aggregate: Sentiment;
  score: number;
  positivity: number;
  turn_count: number;
  analyzed_at: string;
  per_turn: PerTurn[];
}

interface AutoMove {
  from_stage: string | null;
  to_stage: string | null;
  contact_id: string | null;
}

interface CallRow {
  id: string;
  account_id: string;
  conversation_id: string | null;
  from_number: string | null;
  to_number: string | null;
  direction: string | null;
  transcript: unknown;
  metadata: Record<string, unknown> | null;
}

const POS = [
  'ótimo',
  'otimo',
  'excelente',
  'bom',
  'perfeito',
  'interessante',
  'gostei',
  'quero',
  'topo',
  'topei',
  'fechado',
  'fechamos',
  'obrigad',
  'valeu',
  'amei',
  'incrível',
  'incrivel',
  'sensacional',
  'claro',
  'sim',
  'com certeza',
  'de acordo',
];
const NEG = [
  'ruim',
  'péssimo',
  'pessimo',
  'odeio',
  'detesto',
  'caro',
  'caríssimo',
  'carissimo',
  'não quero',
  'nao quero',
  'sem interesse',
  'não preciso',
  'nao preciso',
  'irritado',
  'chato',
  'problema',
  'reclamação',
  'reclamacao',
  'decepc',
  'horrível',
  'horrivel',
  'para de',
  'pare de',
  'não me lig',
  'nao me lig',
  'tira da lista',
];

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Ported from supabase/functions/sentiment-analyze — post-call sentiment
 * scoring + auto-move of the contact's pipeline stage on strong signals.
 * Uses DataSource directly (not TenantTxHost) so it can run both inside an
 * HTTP request (webhook) and inside a BullMQ job (cron retry for stuck
 * calls) — same rationale as AgentToolsService.
 */
@Injectable()
export class CallSentimentService {
  private readonly logger = new Logger(CallSentimentService.name);

  constructor(private readonly dataSource: DataSource) {}

  async analyze(voiceCallId: string): Promise<
    | {
        ok: true;
        voice_call_id: string;
        sentiment: SentimentReport;
        auto_move: AutoMove;
      }
    | { ok: false; error: string; status: number }
  > {
    const rows = await this.dataSource.query<CallRow[]>(
      `SELECT * FROM public.voice_call_get($1)`,
      [voiceCallId],
    );
    const call = rows[0];
    if (!call) return { ok: false, error: 'voice_call not found', status: 404 };

    const turns = this.extractTurns(call.transcript);
    if (turns.length === 0) {
      return {
        ok: false,
        error: 'no transcript turns to analyze',
        status: 400,
      };
    }

    const report = await this.buildReport(turns);

    await this.dataSource.query(
      `SELECT public.voice_call_update_sentiment($1, $2::jsonb)`,
      [call.id, JSON.stringify(report)],
    );

    let autoMove: AutoMove = {
      from_stage: null,
      to_stage: null,
      contact_id: null,
    };
    try {
      autoMove = await this.applySentimentToContact(call, report);
    } catch (err) {
      this.logger.warn(
        `applySentimentToContact failed: ${(err as Error).message}`,
      );
    }

    this.logger.log(
      `call=${call.id} aggregate=${report.aggregate} score=${report.score.toFixed(2)} turns=${report.turn_count} auto_move=${autoMove.from_stage ?? '—'}→${autoMove.to_stage ?? '—'}`,
    );

    return {
      ok: true,
      voice_call_id: call.id,
      sentiment: report,
      auto_move: autoMove,
    };
  }

  private async applySentimentToContact(
    call: CallRow,
    report: SentimentReport,
  ): Promise<AutoMove> {
    const contactId = await this.resolveContactId(call);
    if (!contactId)
      return { from_stage: null, to_stage: null, contact_id: null };

    const baseUpdate = async (extra?: { stageId: string }): Promise<void> => {
      await this.dataSource.query(
        `SELECT public.contact_apply_sentiment($1, $2, $3, $4)`,
        [contactId, report.aggregate, report.score, extra?.stageId ?? null],
      );
    };

    const contactRows = await this.dataSource.query<
      { id: string; stage_id: string | null; account_id: string }[]
    >(`SELECT * FROM public.contact_get_by_id($1)`, [contactId]);
    const contact = contactRows[0];
    if (!contact) {
      await baseUpdate();
      return { from_stage: null, to_stage: null, contact_id: contactId };
    }

    let targetStageName: string | null = null;
    if (report.aggregate === 'negative' && report.score < -0.4) {
      targetStageName = 'Perdeu';
    } else if (
      report.aggregate === 'positive' &&
      report.score > 0.5 &&
      contact.stage_id
    ) {
      const stageRows = await this.dataSource.query<
        { name: string; is_won: boolean; is_lost: boolean }[]
      >(`SELECT * FROM public.lead_stage_get($1)`, [contact.stage_id]);
      const currentStage = stageRows[0];
      if (currentStage && !currentStage.is_won && !currentStage.is_lost) {
        const n = currentStage.name.toLowerCase();
        if (n.includes('novo') || n.includes('contatado'))
          targetStageName = 'Qualificado';
      }
    }

    if (!targetStageName) {
      await baseUpdate();
      return {
        from_stage: contact.stage_id,
        to_stage: null,
        contact_id: contactId,
      };
    }

    if (contact.stage_id) {
      const csRows = await this.dataSource.query<
        { is_won: boolean; is_lost: boolean }[]
      >(`SELECT * FROM public.lead_stage_get($1)`, [contact.stage_id]);
      const cs = csRows[0];
      if (cs && (cs.is_won || cs.is_lost)) {
        await baseUpdate();
        return {
          from_stage: contact.stage_id,
          to_stage: null,
          contact_id: contactId,
        };
      }
    }

    const pipelineRows = await this.dataSource.query<{ id: string }[]>(
      `SELECT * FROM public.lead_pipeline_get_default($1)`,
      [contact.account_id],
    );
    const pipeline = pipelineRows[0];
    if (!pipeline) {
      await baseUpdate();
      return {
        from_stage: contact.stage_id,
        to_stage: null,
        contact_id: contactId,
      };
    }

    const targetRows = await this.dataSource.query<{ id: string }[]>(
      `SELECT * FROM public.lead_stage_find_by_name($1, $2)`,
      [pipeline.id, targetStageName],
    );
    const targetStage = targetRows[0];
    if (!targetStage || targetStage.id === contact.stage_id) {
      await baseUpdate();
      return {
        from_stage: contact.stage_id,
        to_stage: null,
        contact_id: contactId,
      };
    }

    await baseUpdate({ stageId: targetStage.id });

    if (call.conversation_id) {
      await this.dataSource.query(
        `SELECT public.conversation_outcome_insert($1, $2, $3, 'sentiment_auto_move', $4, 'sentiment-analyze', $5::jsonb)`,
        [
          call.account_id,
          call.conversation_id,
          contactId,
          Math.abs(report.score),
          JSON.stringify({
            from_stage_id: contact.stage_id,
            to_stage_id: targetStage.id,
            to_stage_name: targetStageName,
            sentiment: report.aggregate,
            sentiment_score: report.score,
          }),
        ],
      );
    }

    return {
      from_stage: contact.stage_id,
      to_stage: targetStage.id,
      contact_id: contactId,
    };
  }

  private async resolveContactId(call: CallRow): Promise<string | null> {
    const metaContactId = call.metadata?.contact_id;
    if (typeof metaContactId === 'string' && metaContactId)
      return metaContactId;

    if (call.conversation_id) {
      const rows = await this.dataSource.query<{ contact_id: string | null }[]>(
        `SELECT * FROM public.conversation_get_contact_id($1)`,
        [call.conversation_id],
      );
      if (rows[0]?.contact_id) return rows[0].contact_id;
    }

    const leadPhone =
      call.direction === 'outbound' ? call.to_number : call.from_number;
    if (leadPhone) {
      const rows = await this.dataSource.query<{ id: string }[]>(
        `SELECT * FROM public.contact_get_by_phone($1, $2)`,
        [call.account_id, leadPhone],
      );
      if (rows[0]?.id) return rows[0].id;
    }
    return null;
  }

  private extractTurns(transcript: unknown): { role: string; text: string }[] {
    if (!transcript) return [];
    if (typeof transcript === 'string') {
      return transcript
        .split(/\n+/)
        .map((line, i) => ({
          role: i % 2 === 0 ? 'agent' : 'user',
          text: line.trim(),
        }))
        .filter((t) => t.text.length > 0);
    }
    if (Array.isArray(transcript)) {
      return transcript
        .map((t: Record<string, unknown>) => ({
          role: (
            this.asString(t.role) ??
            this.asString(t.speaker) ??
            'user'
          ).toLowerCase(),
          text: (
            this.asString(t.content) ??
            this.asString(t.message) ??
            this.asString(t.text) ??
            ''
          ).trim(),
        }))
        .filter((t) => t.text.length > 0);
    }
    return [];
  }

  private asString(v: unknown): string | null {
    return typeof v === 'string' ? v : null;
  }

  private async buildReport(
    turns: { role: string; text: string }[],
  ): Promise<SentimentReport> {
    let perTurn: PerTurn[];
    try {
      perTurn = await this.analyzeWithLLM(turns);
    } catch {
      perTurn = this.analyzeWithLexicon(turns);
    }

    const userTurns = perTurn.filter(
      (t) => t.role === 'user' || t.role === 'human' || t.role === 'lead',
    );
    const sample = userTurns.length > 0 ? userTurns : perTurn;
    const avgScore = sample.reduce((s, t) => s + t.score, 0) / sample.length;
    const aggregate: Sentiment =
      avgScore > 0.15 ? 'positive' : avgScore < -0.15 ? 'negative' : 'neutral';
    const positivity = (avgScore + 1) / 2;

    return {
      aggregate,
      score: Number(avgScore.toFixed(3)),
      positivity: Number(positivity.toFixed(3)),
      turn_count: perTurn.length,
      analyzed_at: new Date().toISOString(),
      per_turn: perTurn,
    };
  }

  private async analyzeWithLLM(
    turns: { role: string; text: string }[],
  ): Promise<PerTurn[]> {
    const sample = turns.slice(0, 60);
    const numbered = sample
      .map((t, i) => `[${i}] (${t.role}) ${t.text.slice(0, 280)}`)
      .join('\n');

    const prompt = `Para cada turno abaixo, classifique o sentimento em "positive", "neutral" ou "negative" com um score de -1 a 1. Devolva APENAS JSON válido.

Turnos:
${numbered}

Formato:
{
  "turns": [
    {"index": 0, "sentiment": "neutral", "score": 0.0},
    ...
  ]
}`;

    const content = await lovableChatCompletion({
      model: 'google/gemini-2.5-flash-lite',
      messages: [{ role: 'user', content: prompt }],
      jsonMode: true,
    });
    if (!content) return this.analyzeWithLexicon(turns);

    const parsed = JSON.parse(content) as {
      turns?: { index: number; sentiment: string; score: number }[];
    };
    const arr = Array.isArray(parsed.turns) ? parsed.turns : [];

    return sample.map((t, i) => {
      const found = arr.find((x) => x.index === i);
      const sent: Sentiment =
        found?.sentiment === 'positive' ||
        found?.sentiment === 'negative' ||
        found?.sentiment === 'neutral'
          ? found.sentiment
          : 'neutral';
      const score =
        typeof found?.score === 'number' ? clamp(found.score, -1, 1) : 0;
      return { index: i, role: t.role, sentiment: sent, score };
    });
  }

  private analyzeWithLexicon(
    turns: { role: string; text: string }[],
  ): PerTurn[] {
    return turns.map((t, i) => {
      const text = t.text.toLowerCase();
      let score = 0;
      for (const w of POS) if (text.includes(w)) score += 0.4;
      for (const w of NEG) if (text.includes(w)) score -= 0.4;
      score = clamp(score, -1, 1);
      const sentiment: Sentiment =
        score > 0.15 ? 'positive' : score < -0.15 ? 'negative' : 'neutral';
      return {
        index: i,
        role: t.role,
        sentiment,
        score: Number(score.toFixed(2)),
      };
    });
  }
}

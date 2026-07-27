import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { lovableChatCompletion } from './lovable-ai.util';
import type { ToolResponse } from './call-transcription.service';

function ok(body: Record<string, unknown>, status = 200): ToolResponse {
  return { status, body: { ok: true, ...body } };
}
function fail(error: string, status: number): ToolResponse {
  return { status, body: { ok: false, error } };
}

/** Ported from supabase/functions/call-summary-generate. */
@Injectable()
export class CallSummaryService {
  private readonly logger = new Logger(CallSummaryService.name);

  constructor(private readonly dataSource: DataSource) {}

  async generate(voiceCallId: string, force = false): Promise<ToolResponse> {
    const rows = await this.dataSource.query<
      {
        id: string;
        transcript: unknown;
        metadata: Record<string, unknown> | null;
        ai_summary: string | null;
      }[]
    >(`SELECT * FROM public.voice_call_get($1)`, [voiceCallId]);
    const call = rows[0];
    if (!call) return fail('voice_call not found', 404);

    if (call.ai_summary && !force) {
      return ok({
        voice_call_id: call.id,
        skipped: true,
        ai_summary: call.ai_summary,
      });
    }

    const transcriptText = this.extractTranscriptText(call.transcript);
    if (!transcriptText) return fail('no transcript', 400);

    if (!process.env.LOVABLE_API_KEY)
      return fail('LOVABLE_API_KEY missing', 500);

    const kind = (call.metadata?.campaign_kind as string | undefined) ?? 'sdr';
    const sample = transcriptText.slice(0, 6000);

    const prompt = `Você é um analista de operações de IA. Analise a transcrição abaixo de uma ligação de tipo "${kind}" e gere um RESUMO EXECUTIVO em PT-BR.

Formato OBRIGATÓRIO (markdown):
**Resultado:** <1 linha>
**Pontos-chave:**
- <ponto 1>
- <ponto 2>
- <ponto 3>
**Próxima ação:** <recomendação concreta, 1 linha>

Máximo 600 caracteres no total. Seja específico e objetivo.

Transcrição:
${sample}`;

    const content = await lovableChatCompletion({
      model: 'google/gemini-2.5-flash',
      messages: [{ role: 'user', content: prompt }],
    });
    if (content === null) {
      this.logger.error('LLM call failed');
      return fail('LLM call failed', 502);
    }

    const summary = content.trim().slice(0, 1200);
    if (!summary) return fail('empty summary', 500);

    await this.dataSource.query(
      `SELECT public.voice_call_update_summary($1, $2)`,
      [call.id, summary],
    );

    return ok({ voice_call_id: call.id, ai_summary: summary });
  }

  private extractTranscriptText(transcript: unknown): string {
    if (!transcript) return '';
    if (typeof transcript === 'string') return transcript;
    if (Array.isArray(transcript)) {
      return transcript
        .map((t: Record<string, unknown>) => {
          const role = this.asString(t.role) ?? this.asString(t.speaker) ?? '';
          const content =
            this.asString(t.content) ??
            this.asString(t.message) ??
            this.asString(t.text) ??
            '';
          return `${role}: ${content}`;
        })
        .filter(Boolean)
        .join('\n');
    }
    return '';
  }

  private asString(v: unknown): string | null {
    return typeof v === 'string' ? v : null;
  }
}

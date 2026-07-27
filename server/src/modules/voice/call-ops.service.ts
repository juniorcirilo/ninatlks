import { Injectable, NotFoundException, Scope } from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';
import {
  TwilioConfigService,
  TwilioConfigError,
} from '../twilio/twilio-config.service';
import { TwilioClientService } from '../twilio/twilio-client.service';
import { ElevenLabsConfigService } from '../elevenlabs/elevenlabs-config.service';
import { ElevenLabsClientService } from '../elevenlabs/elevenlabs-client.service';
import { lovableChatCompletion } from './lovable-ai.util';

interface CancelableCall {
  id: string;
  provider_call_sid: string | null;
  source_id: string | null;
  metadata: Record<string, unknown> | null;
}

const RECLASSIFY_CATEGORIES = [
  'interested',
  'not_interested',
  'callback_requested',
  'voicemail',
  'wrong_number',
  'do_not_call',
  'no_answer',
  'busy',
  'failed',
  'escalated',
  'other',
] as const;
type ReclassifyCategory = (typeof RECLASSIFY_CATEGORIES)[number];

const RECLASSIFY_HEURISTICS: {
  category: ReclassifyCategory;
  patterns: RegExp[];
}[] = [
  {
    category: 'do_not_call',
    patterns: [
      /n[aã]o me lig[ua]/,
      /para de me lig/,
      /pare de lig/,
      /n[aã]o quero mais receber/,
      /n[aã]o ligue mais/,
      /me tira da lista/,
      /remover da lista/,
      /n[aã]o me incomod/,
    ],
  },
  {
    category: 'wrong_number',
    patterns: [
      /n[uú]mero errado/,
      /n[aã]o conhe[çc]o/,
      /pessoa errada/,
      /n[aã]o [eé] essa pessoa/,
    ],
  },
  {
    category: 'callback_requested',
    patterns: [
      /me lig[ua] (depois|mais tarde|amanh[aã])/,
      /retorn[ae] (depois|mais tarde)/,
      /agora n[aã]o posso/,
      /estou ocupad/,
      /pode ligar (depois|amanh[aã])/,
    ],
  },
  {
    category: 'not_interested',
    patterns: [
      /n[aã]o tenho interesse/,
      /n[aã]o me interessa/,
      /n[aã]o quero/,
      /n[aã]o preciso/,
      /sem interesse/,
    ],
  },
  {
    category: 'interested',
    patterns: [
      /tenho interesse/,
      /quero (saber mais|comprar|contratar|conhecer)/,
      /me manda (mais|por whatsapp)/,
      /pode mandar/,
      /vou querer/,
      /fech[ao]u/,
      /aceito/,
    ],
  },
  {
    category: 'voicemail',
    patterns: [/deixe (sua|uma) mensagem/, /caixa postal/, /ap[óo]s o sinal/],
  },
];

export interface ReclassifyResult {
  category: ReclassifyCategory;
  confidence: number;
  summary: string;
}

/**
 * Ported from supabase/functions/voice-call-cancel and voice-reclassify.
 * Scope.REQUEST (TenantTxHost) — both are real authenticated operator
 * actions, unlike the webhook/job-facing services elsewhere in this module.
 */
@Injectable({ scope: Scope.REQUEST })
export class CallOpsService {
  constructor(
    private readonly tx: TenantTxHost,
    private readonly twilioConfig: TwilioConfigService,
    private readonly twilioClient: TwilioClientService,
    private readonly elConfig: ElevenLabsConfigService,
    private readonly elClient: ElevenLabsClientService,
  ) {}

  /**
   * Hard-stops active calls for a single voice_call_id or an entire
   * campaign. Both branches are scoped to `accountId` (the route's
   * AccountMemberGuard already verified membership) — this also closes a
   * gap in the original, where the campaign_id early-return path (zero
   * dispatched calls) skipped the per-account membership check entirely.
   */
  async cancel(
    accountId: string,
    input: { voiceCallId?: string; campaignId?: string },
    canceledByUserId: string,
  ): Promise<{ ok: true; canceled: number; errors: string[] }> {
    if (!input.voiceCallId && !input.campaignId) {
      throw new NotFoundException('voice_call_id or campaign_id required');
    }

    let calls: CancelableCall[];
    if (input.voiceCallId) {
      calls = await this.tx.manager.query<CancelableCall[]>(
        `SELECT id, provider_call_sid, source_id, metadata FROM voice_calls
         WHERE id = $1 AND account_id = $2 AND status IN ('queued','ringing','in_progress')`,
        [input.voiceCallId, accountId],
      );
    } else {
      const contactRows = await this.tx.manager.query<
        { voice_call_id: string | null }[]
      >(
        `SELECT voice_call_id FROM voice_campaign_contacts
         WHERE campaign_id = $1 AND account_id = $2 AND voice_call_id IS NOT NULL`,
        [input.campaignId, accountId],
      );
      const ids = contactRows
        .map((c) => c.voice_call_id)
        .filter((v): v is string => Boolean(v));
      if (ids.length === 0) {
        await this.tx.manager.query(
          `UPDATE voice_campaign_contacts SET status = 'canceled'
           WHERE campaign_id = $1 AND account_id = $2 AND status IN ('queued','placed')`,
          [input.campaignId, accountId],
        );
        return { ok: true, canceled: 0, errors: [] };
      }
      calls = await this.tx.manager.query<CancelableCall[]>(
        `SELECT id, provider_call_sid, source_id, metadata FROM voice_calls
         WHERE id = ANY($1) AND account_id = $2 AND status IN ('queued','ringing','in_progress')`,
        [ids, accountId],
      );
    }

    let twilioCreds;
    try {
      twilioCreds = await this.twilioConfig.loadAccountCreds(accountId);
    } catch (err) {
      if (!(err instanceof TwilioConfigError)) throw err;
      twilioCreds = null;
    }
    const elCreds = await this.elConfig
      .loadAccountCreds(accountId)
      .catch(() => null);

    let canceled = 0;
    const errors: string[] = [];

    for (const call of calls) {
      if (call.provider_call_sid && twilioCreds) {
        try {
          await this.twilioClient.request({
            method: 'POST',
            path: `/2010-04-01/Accounts/${twilioCreds.accountSid}/Calls/${call.provider_call_sid}.json`,
            credentials: twilioCreds,
            form: { Status: 'completed' },
          });
        } catch (err) {
          errors.push(
            `twilio ${call.provider_call_sid}: ${(err as Error).message}`,
          );
        }
      }

      const elConvId =
        call.source_id ??
        (call.metadata?.elevenlabs_conversation_id as string | undefined);
      if (elConvId && elCreds) {
        try {
          await this.elClient.request({
            method: 'DELETE',
            path: `/v1/convai/conversations/${elConvId}`,
            credentials: elCreds,
          });
        } catch {
          // best-effort, matches original
        }
      }

      await this.tx.manager.query(
        `UPDATE voice_calls SET status = 'canceled', ended_at = now(), metadata = $2::jsonb WHERE id = $1`,
        [
          call.id,
          JSON.stringify({
            ...(call.metadata ?? {}),
            canceled_by: canceledByUserId,
            canceled_at: new Date().toISOString(),
          }),
        ],
      );
      canceled++;
    }

    if (input.campaignId) {
      await this.tx.manager.query(
        `UPDATE voice_campaign_contacts SET status = 'canceled'
         WHERE campaign_id = $1 AND account_id = $2 AND status IN ('queued','placed')`,
        [input.campaignId, accountId],
      );
    }

    return { ok: true, canceled, errors };
  }

  /** Ported from supabase/functions/voice-reclassify. */
  async reclassify(
    accountId: string,
    voiceCallId: string,
    addedByUserId: string,
  ): Promise<ReclassifyResult> {
    const rows = await this.tx.manager.query<
      {
        id: string;
        to_number: string;
        transcript: unknown;
        metadata: Record<string, unknown> | null;
      }[]
    >(
      `SELECT id, to_number, transcript, metadata FROM voice_calls WHERE id = $1 AND account_id = $2 LIMIT 1`,
      [voiceCallId, accountId],
    );
    const call = rows[0];
    if (!call) throw new NotFoundException('call not found');

    const summary = (call.metadata?.summary as string | undefined) ?? null;
    const transcriptText = this.extractTranscriptText(call.transcript);
    if (!transcriptText && !summary) {
      throw new NotFoundException('no transcript or summary to classify');
    }

    const classification = await this.classifyOutcome(transcriptText, summary);

    await this.tx.manager.query(
      `UPDATE voice_calls SET outcome_category = $2, outcome_confidence = $3,
         outcome_summary = $4, outcome_classified_at = now() WHERE id = $1`,
      [
        call.id,
        classification.category,
        classification.confidence,
        classification.summary,
      ],
    );

    if (classification.category === 'do_not_call' && call.to_number) {
      await this.tx.manager.query(
        `INSERT INTO dnc_list (account_id, phone_number, source, reason, notes, added_by, created_at, registered_at)
         VALUES ($1, $2, 'ai_classified', $3, $4, $5, now(), now())
         ON CONFLICT (account_id, phone_number) DO NOTHING`,
        [
          accountId,
          call.to_number,
          classification.summary,
          `manual reclassification of voice_call ${call.id}`,
          addedByUserId,
        ],
      );
    }

    return classification;
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
        .join('\n');
    }
    return '';
  }

  private asString(v: unknown): string | null {
    return typeof v === 'string' ? v : null;
  }

  private async classifyOutcome(
    transcriptText: string,
    summary: string | null,
  ): Promise<ReclassifyResult> {
    const text = (transcriptText + '\n' + (summary ?? '')).toLowerCase();

    for (const h of RECLASSIFY_HEURISTICS) {
      for (const p of h.patterns) {
        if (p.test(text)) {
          return {
            category: h.category,
            confidence: 0.95,
            summary: this.extractSummaryFromText(text, 120),
          };
        }
      }
    }

    if (!process.env.LOVABLE_API_KEY) {
      return { category: 'other', confidence: 0.3, summary: summary ?? '' };
    }

    const sample = (transcriptText || summary || '').slice(0, 2000);
    const prompt = `Classifique o resultado desta ligação telefônica em UMA categoria. Responda APENAS JSON válido sem markdown.

Categorias permitidas:
- interested, not_interested, callback_requested, voicemail, wrong_number, do_not_call, no_answer, busy, failed, escalated, other

Transcript:
${sample}

Responda EXATAMENTE neste formato JSON:
{"category":"<uma das categorias>","confidence":<0..1>,"summary":"<1 frase em PT-BR>"}`;

    const content = await lovableChatCompletion({
      model: 'google/gemini-2.5-flash-lite',
      messages: [{ role: 'user', content: prompt }],
      jsonMode: true,
    });
    if (!content)
      return { category: 'other', confidence: 0.3, summary: summary ?? '' };

    try {
      const parsed = JSON.parse(content) as {
        category?: string;
        confidence?: number;
        summary?: string;
      };
      const category = (RECLASSIFY_CATEGORIES as readonly string[]).includes(
        parsed.category ?? '',
      )
        ? (parsed.category as ReclassifyCategory)
        : 'other';
      return {
        category,
        confidence:
          typeof parsed.confidence === 'number'
            ? Math.max(0, Math.min(1, parsed.confidence))
            : 0.5,
        summary:
          typeof parsed.summary === 'string'
            ? parsed.summary.slice(0, 280)
            : (summary ?? ''),
      };
    } catch {
      return { category: 'other', confidence: 0.3, summary: summary ?? '' };
    }
  }

  private extractSummaryFromText(text: string, max: number): string {
    return text.replace(/\s+/g, ' ').trim().slice(0, max);
  }
}

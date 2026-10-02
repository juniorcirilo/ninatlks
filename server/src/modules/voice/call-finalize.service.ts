import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ElevenLabsClientService } from '../elevenlabs/elevenlabs-client.service';
import { StorageService } from '../storage/storage.service';
import { resolveElevenLabsApiKey } from './elevenlabs-creds.util';
import { CallClassificationService } from './call-classification.service';
import { CallSentimentService } from './call-sentiment.service';
import {
  applyCadenceDisposition,
  applyCampaignDisposition,
  dispositionFromElevenLabs,
} from './campaign-disposition.util';
import { WebhookDispatchService } from '../webhook-endpoints/webhook-dispatch.service';

const BUCKET = 'voice-recordings';
const RECORDING_URL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days, matches original signed URL

interface CallRow {
  id: string;
  account_id: string;
  source_id: string | null;
  provider_call_sid: string | null;
  status: string;
  recording_storage_path: string | null;
  transcript: unknown;
  transcription_status: string | null;
  metadata: Record<string, unknown> | null;
  started_at: Date | null;
}

interface ElConversationData {
  status?: string;
  transcript?: unknown[];
  metadata?: {
    call_duration_secs?: number;
    start_time_unix_secs?: number;
    cost?: number;
  };
  analysis?: {
    transcript_summary?: string;
    call_successful?: string | boolean;
    evaluation_criteria_results?: Record<string, unknown>;
    data_collection_results?: Record<string, unknown>;
  };
  transcript_summary?: string;
  duration_seconds?: number;
}

export interface FinalizeResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Ported from supabase/functions/voice-call-finalize — the canonical
 * post-call pipeline: pulls the finished conversation (transcript + audio)
 * from ElevenLabs' Convai API, persists it, then fans out to classification
 * + sentiment. elevenlabs-events (webhook) and the finalize-pending cron
 * retry both call this directly as an in-process method (not HTTP loopback
 * like the original two edge functions did) — same pattern already used by
 * VoiceElOutboundService calling VoiceOutboundService.
 */
@Injectable()
export class CallFinalizeService {
  private readonly logger = new Logger(CallFinalizeService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly elClient: ElevenLabsClientService,
    private readonly storage: StorageService,
    private readonly classification: CallClassificationService,
    private readonly sentiment: CallSentimentService,
    private readonly dispatch: WebhookDispatchService,
  ) {}

  async finalize(voiceCallId: string, force = false): Promise<FinalizeResult> {
    const rows = await this.dataSource.query<CallRow[]>(
      `SELECT * FROM public.voice_call_get($1)`,
      [voiceCallId],
    );
    const call = rows[0];
    if (!call) return { status: 404, body: { error: 'voice_call not found' } };

    const conversationId = call.source_id;
    if (!conversationId) {
      return {
        status: 422,
        body: { error: 'no source_id (EL conversation_id) — cannot finalize' },
      };
    }

    const transcriptIsEmpty =
      !call.transcript ||
      (Array.isArray(call.transcript) && call.transcript.length === 0);

    if (
      !force &&
      call.status === 'completed' &&
      call.recording_storage_path &&
      !transcriptIsEmpty
    ) {
      return {
        status: 200,
        body: { ok: true, skipped: true, reason: 'already finalized' },
      };
    }

    const elKey = await resolveElevenLabsApiKey(
      this.dataSource,
      call.account_id,
    );
    if (!elKey) {
      return {
        status: 503,
        body: { error: 'ElevenLabs key not configured for account' },
      };
    }

    let convData: ElConversationData;
    try {
      const res = await this.elClient.request<Response>({
        method: 'GET',
        path: `/v1/convai/conversations/${encodeURIComponent(conversationId)}`,
        credentials: { apiKey: elKey },
        raw: true,
      });
      if (res.status === 404) {
        return {
          status: 202,
          body: {
            ok: false,
            reason: 'conversation not found in EL yet',
            retry_later: true,
          },
        };
      }
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        this.logger.error(
          `EL convo fetch failed ${res.status}: ${t.slice(0, 300)}`,
        );
        return {
          status: 502,
          body: { error: `EL fetch failed: ${res.status}` },
        };
      }
      convData = (await res.json()) as ElConversationData;
    } catch (err) {
      this.logger.error(`EL convo fetch exception: ${(err as Error).message}`);
      return { status: 502, body: { error: 'EL fetch exception' } };
    }

    const elStatus = String(convData.status ?? '').toLowerCase();
    const transcriptArr: unknown[] = Array.isArray(convData.transcript)
      ? convData.transcript
      : [];
    const summary: string | null =
      convData.analysis?.transcript_summary ??
      convData.transcript_summary ??
      null;
    const durationSec: number | null =
      convData.metadata?.call_duration_secs ??
      convData.duration_seconds ??
      null;

    const stillProcessing =
      elStatus === 'in-progress' || elStatus === 'processing';
    if (stillProcessing && transcriptArr.length === 0) {
      await this.dataSource.query(
        `SELECT public.voice_call_update_metadata($1, $2::jsonb)`,
        [
          call.id,
          JSON.stringify({
            ...(call.metadata ?? {}),
            el_status: elStatus,
            last_finalize_attempt: new Date().toISOString(),
          }),
        ],
      );
      return {
        status: 202,
        body: {
          ok: false,
          reason: 'EL still processing',
          retry_later: true,
          el_status: elStatus,
        },
      };
    }

    let recordingStoragePath: string | null =
      call.recording_storage_path ?? null;
    let recordingSignedUrl: string | null = null;

    if (!recordingStoragePath) {
      try {
        const audioRes = await this.elClient.request<Response>({
          method: 'GET',
          path: `/v1/convai/conversations/${encodeURIComponent(conversationId)}/audio`,
          credentials: { apiKey: elKey },
          raw: true,
        });
        if (audioRes.ok) {
          const buf = Buffer.from(await audioRes.arrayBuffer());
          const ym = new Date().toISOString().slice(0, 7);
          const key = `${call.account_id}/${ym}/${call.id}.mp3`;
          const contentType =
            audioRes.headers.get('content-type') ?? 'audio/mpeg';
          await this.storage.uploadObject(BUCKET, key, buf, contentType);
          recordingStoragePath = `${BUCKET}/${key}`;
          recordingSignedUrl = await this.storage.presignDownload(
            key,
            BUCKET,
            RECORDING_URL_TTL_SECONDS,
          );
        } else {
          this.logger.warn(`audio fetch ${audioRes.status}`);
        }
      } catch (err) {
        this.logger.warn(`audio fetch exception: ${(err as Error).message}`);
      }
    }

    const nowIso = new Date().toISOString();

    // Captura campos da análise EL que chegam da API mas não têm coluna própria.
    const elAnalysis = convData.analysis ?? {};
    const callSuccessful = elAnalysis.call_successful;
    const elCost = convData.metadata?.cost;
    const elStartTime = convData.metadata?.start_time_unix_secs;

    const metadata = {
      ...(call.metadata ?? {}),
      summary,
      el_status: elStatus,
      finalized_at: nowIso,
      ...(callSuccessful !== undefined ? { el_call_successful: callSuccessful } : {}),
      ...(elCost !== undefined ? { el_cost: elCost } : {}),
      ...(elStartTime !== undefined ? { el_start_time_unix_secs: elStartTime } : {}),
      ...(elAnalysis.evaluation_criteria_results
        ? { el_evaluation_criteria: elAnalysis.evaluation_criteria_results }
        : {}),
      ...(elAnalysis.data_collection_results
        ? { el_data_collection: elAnalysis.data_collection_results }
        : {}),
    };

    try {
      await this.dataSource.query(
        `SELECT public.voice_call_finalize($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7)`,
        [
          call.id,
          nowIso,
          JSON.stringify(metadata),
          transcriptArr.length > 0 ? JSON.stringify(transcriptArr) : null,
          durationSec ?? null,
          recordingStoragePath ?? null,
          recordingSignedUrl ?? null,
        ],
      );
    } catch (err) {
      this.logger.error(`update voice_calls failed: ${(err as Error).message}`);
      return { status: 500, body: { error: 'db update failed' } };
    }

    const disposition = dispositionFromElevenLabs(
      elStatus,
      durationSec,
      transcriptArr.length,
    );

    // Sequencial, não Promise.allSettled: CallSentimentService relê
    // contacts.stage_id do banco antes de decidir seu próprio auto-move
    // (call-sentiment.service.ts), então rodar a classificação primeiro faz
    // o sentimento decidir sobre o estado já atualizado em vez de correr
    // contra ele — sem isso, os dois gravam stage_id de forma independente e
    // quem termina por último vence, sem ordem determinística.
    //
    // disposition é calculado antes e passado adiante porque classify() —
    // via applySmartRetry — é quem efetivamente grava outcome/status em
    // voice_campaign_contacts quando a ligação foi classificada (o guard da
    // função no banco só deixa applyCampaignDisposition, mais abaixo, agir
    // sobre contato ainda em voo).
    let classify:
      | Awaited<ReturnType<CallClassificationService['classify']>>
      | { error: string };
    try {
      classify = await this.classification.classify(
        call.id,
        disposition,
        durationSec,
      );
    } catch (err) {
      classify = { error: (err as Error).message };
    }

    let sentimentOut:
      | Awaited<ReturnType<CallSentimentService['analyze']>>
      | { error: string };
    try {
      sentimentOut = await this.sentiment.analyze(call.id);
    } catch (err) {
      sentimentOut = { error: (err as Error).message };
    }

    // Depois da classificação, de propósito. Ela roda o smart retry, que é
    // mais específico e pode reenfileirar o contato; a função no banco só age
    // sobre contato ainda em voo, então aqui ela preenche exatamente a lacuna
    // que existia — a ligação que nunca foi atendida, onde não há transcrição,
    // a classificação não roda e o contato ficava preso em 'placed'.
    await applyCampaignDisposition(
      this.dataSource,
      call.metadata?.campaign_contact_id as string | number | undefined,
      disposition,
      durationSec,
    );

    // Mesma lógica pro lado de cadência: cadence-tick.processor.ts deixou a
    // execução em 'running' esperando este desfecho em vez de avançar cega
    // no disparo (metadata.cadence_execution_id só existe pra ligações
    // originadas por follow-up).
    await applyCadenceDisposition(
      this.dataSource,
      call.metadata?.cadence_execution_id as string | undefined,
      disposition,
    );

    await this.emitCallFinished(call.id);

    const stageAssigned =
      ('stage_id' in classify && classify.stage_id) ||
      ('auto_move' in sentimentOut && sentimentOut.auto_move.to_stage);
    if (stageAssigned) {
      const contactId =
        ('contact_id' in classify && classify.contact_id) ||
        ('auto_move' in sentimentOut && sentimentOut.auto_move.contact_id) ||
        null;
      if (contactId) await this.emitDispositionChanged(call.id, contactId);
    }

    this.logger.log(
      `call=${call.id} convo=${conversationId} transcript=${transcriptArr.length}msgs audio=${recordingStoragePath ? 'ok' : '—'} ` +
        `category=${'classification' in classify ? classify.classification?.category : '—'} ` +
        `sentiment=${'sentiment' in sentimentOut ? sentimentOut.sentiment?.aggregate : '—'}`,
    );

    return {
      status: 200,
      body: {
        ok: true,
        voice_call_id: call.id,
        transcript_messages: transcriptArr.length,
        duration_seconds: durationSec,
        recording_storage_path: recordingStoragePath,
        summary,
        classify,
        sentiment: sentimentOut,
      },
    };
  }

  /**
   * Evento `call.finished` para os destinos de envio da conta.
   *
   * Relido do banco em vez de montado com o que está em memória aqui: a
   * classificação e o sentimento acabaram de gravar `outcome_category`,
   * `outcome_summary` e `sentiment`, e é justamente esse conteúdo que o CRM do
   * cliente quer. Montar do que temos na mão mandaria o desfecho vazio.
   *
   * Nunca lança: webhook é efeito colateral do pós-chamada, e o pós-chamada já
   * terminou. Falha aqui vira log, não erro de finalização.
   */
  private async emitCallFinished(voiceCallId: string): Promise<void> {
    try {
      const rows = await this.dataSource.query<
        {
          id: string;
          account_id: string;
          direction: string;
          status: string;
          from_number: string;
          to_number: string;
          duration_seconds: number;
          started_at: Date | null;
          ended_at: Date | null;
          recording_storage_path: string | null;
          outcome_category: string | null;
          outcome_summary: string | null;
          ai_summary: string | null;
          sentiment: Record<string, unknown> | null;
          persona_id: string | null;
          contact_id: string | null;
          contact_name: string | null;
          contact_external_id: string | null;
          campaign_id: string | null;
          campaign_name: string | null;
          disposition: string | null;
        }[]
      >(
        `SELECT vc.id, vc.account_id, vc.direction::text, vc.status::text,
                vc.from_number, vc.to_number, vc.duration_seconds,
                vc.started_at, vc.ended_at, vc.recording_storage_path,
                vc.outcome_category, vc.outcome_summary, vc.ai_summary,
                vc.sentiment, vc.persona_id,
                c.id AS contact_id, c.name AS contact_name,
                c.external_id AS contact_external_id,
                camp.id AS campaign_id, camp.name AS campaign_name,
                vcc.outcome AS disposition
           FROM public.voice_calls vc
           LEFT JOIN public.voice_campaign_contacts vcc ON vcc.voice_call_id = vc.id
           LEFT JOIN public.voice_campaigns camp ON camp.id = vcc.campaign_id
           LEFT JOIN public.contacts c ON c.id = vcc.contact_id
          WHERE vc.id = $1
          LIMIT 1`,
        [voiceCallId],
      );
      const row = rows[0];
      if (!row) return;

      await this.dispatch.emit(
        row.account_id,
        'call.finished',
        {
          call_id: row.id,
          direction: row.direction,
          status: row.status,
          from: row.from_number,
          to: row.to_number,
          duration_seconds: row.duration_seconds,
          started_at: row.started_at,
          ended_at: row.ended_at,
          recording_storage_path: row.recording_storage_path,
          outcome_category: row.outcome_category,
          outcome_summary: row.outcome_summary ?? row.ai_summary,
          disposition: row.disposition,
          sentiment: row.sentiment,
          persona_id: row.persona_id,
          contact: row.contact_id
            ? {
                id: row.contact_id,
                name: row.contact_name,
                external_id: row.contact_external_id,
                phone: row.to_number,
              }
            : null,
          campaign: row.campaign_id
            ? { id: row.campaign_id, name: row.campaign_name }
            : null,
        },
        { agentId: row.persona_id },
      );
    } catch (err) {
      this.logger.warn(
        `emitir call.finished falhou para call=${voiceCallId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Evento `contact.disposition_changed` — dispara sempre que a classificação
   * ou o sentimento desta ligação resolveram um estágio para o contato
   * (mesmo que o estágio final acabe igual ao anterior). Relido do banco
   * pelo mesmo motivo de `emitCallFinished`: o estado que importa é o que
   * ficou gravado depois das duas etapas, não o que cada uma tinha em mãos
   * isoladamente.
   */
  private async emitDispositionChanged(
    voiceCallId: string,
    contactId: string,
  ): Promise<void> {
    try {
      const contactRows = await this.dataSource.query<
        {
          id: string;
          account_id: string;
          name: string | null;
          phone_number: string | null;
          stage_id: string | null;
          score: number | null;
          source: string | null;
          briefing: Record<string, unknown> | null;
          last_sentiment: string | null;
          last_sentiment_score: number | null;
          stage_source: string | null;
        }[]
      >(`SELECT * FROM public.contact_get_by_id($1)`, [contactId]);
      const contact = contactRows[0];
      if (!contact) return;

      let stageName: string | null = null;
      if (contact.stage_id) {
        const stageRows = await this.dataSource.query<
          { name: string; is_won: boolean; is_lost: boolean }[]
        >(`SELECT * FROM public.lead_stage_get($1)`, [contact.stage_id]);
        stageName = stageRows[0]?.name ?? null;
      }

      const callRows = await this.dataSource.query<
        { persona_id: string | null; outcome_category: string | null }[]
      >(
        `SELECT persona_id, outcome_category FROM public.voice_calls WHERE id = $1 LIMIT 1`,
        [voiceCallId],
      );
      const call = callRows[0];

      await this.dispatch.emit(
        contact.account_id,
        'contact.disposition_changed',
        {
          call_id: voiceCallId,
          contact: {
            id: contact.id,
            name: contact.name,
            phone: contact.phone_number,
          },
          stage: contact.stage_id
            ? { id: contact.stage_id, name: stageName }
            : null,
          stage_source: contact.stage_source,
          score: contact.score,
          source: contact.source,
          briefing: contact.briefing,
          sentiment: contact.last_sentiment
            ? {
                aggregate: contact.last_sentiment,
                score: contact.last_sentiment_score,
              }
            : null,
          outcome_category: call?.outcome_category ?? null,
        },
        { agentId: call?.persona_id ?? null },
      );
    } catch (err) {
      this.logger.warn(
        `emitir contact.disposition_changed falhou para call=${voiceCallId}: ${(err as Error).message}`,
      );
    }
  }
}

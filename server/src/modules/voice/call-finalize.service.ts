import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ElevenLabsClientService } from '../elevenlabs/elevenlabs-client.service';
import { StorageService } from '../storage/storage.service';
import { resolveElevenLabsApiKey } from './elevenlabs-creds.util';
import { CallClassificationService } from './call-classification.service';
import { CallSentimentService } from './call-sentiment.service';

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
  metadata?: { call_duration_secs?: number };
  analysis?: { transcript_summary?: string };
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
    const metadata = {
      ...(call.metadata ?? {}),
      summary,
      el_status: elStatus,
      finalized_at: nowIso,
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

    const [classifyResult, sentimentResult] = await Promise.allSettled([
      this.classification.classify(call.id),
      this.sentiment.analyze(call.id),
    ]);

    const classify =
      classifyResult.status === 'fulfilled'
        ? classifyResult.value
        : { error: String(classifyResult.reason) };
    const sentimentOut =
      sentimentResult.status === 'fulfilled'
        ? sentimentResult.value
        : { error: String(sentimentResult.reason) };

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
}

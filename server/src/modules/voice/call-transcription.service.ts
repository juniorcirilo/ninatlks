import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { StorageService } from '../storage/storage.service';
import { resolveTwilioCreds } from '../twilio/twilio-creds.util';
import { TwilioConfigError } from '../twilio/twilio-config.service';

const BUCKET = 'voice-recordings';
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days, matches original
const DEEPGRAM_SIGN_TTL_SECONDS = 60 * 60; // 1h, matches original signRecordingUrl call

interface DeepgramUtterance {
  speaker: number;
  start: number;
  end: number;
  transcript: string;
  confidence: number;
}

interface DeepgramResult {
  transcriptText: string;
  utterances: DeepgramUtterance[];
  language?: string;
  durationSec?: number;
}

export interface ToolResponse {
  status: number;
  body: Record<string, unknown>;
}

function ok(body: Record<string, unknown>, status = 200): ToolResponse {
  return { status, body: { ok: true, ...body } };
}
function fail(error: string, status: number): ToolResponse {
  return { status, body: { ok: false, error } };
}

/**
 * Ported from supabase/functions/twilio-recording-callback (recording
 * download + storage persistence) and supabase/functions/transcribe-voice
 * (Deepgram batch transcription) — the two only make sense together, since
 * transcribe-voice requires recording_storage_path to already be set by the
 * recording-callback step. DataSource direct: the recording-callback runs
 * from an unauthenticated Twilio webhook, so no request-scoped services —
 * all `voice_calls` access goes through SECURITY DEFINER wrappers (see
 * migrations/20260720200000-CallTranscriptionBypass.ts) since the plain
 * DataSource pool has no tenant session vars set.
 */
@Injectable()
export class CallTranscriptionService {
  private readonly logger = new Logger(CallTranscriptionService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: StorageService,
  ) {}

  /**
   * Downloads the Twilio recording MP3 and uploads it to our storage,
   * then fires transcribeVoice(). Called from the RecordingStatusCallback
   * webhook — best-effort, never throws (caller always responds 200 to
   * Twilio regardless of outcome, matching the original).
   */
  async persistAndTranscribe(params: {
    callSid: string;
    recordingSid: string;
    durationSec: number | null;
  }): Promise<void> {
    const rows = await this.dataSource.query<
      { id: string; account_id: string }[]
    >(`SELECT * FROM public.voice_call_get_by_provider_sid($1)`, [
      params.callSid,
    ]);
    const call = rows[0];
    if (!call) {
      this.logger.warn(`no voice_calls for ${params.callSid}`);
      return;
    }

    let creds;
    try {
      creds = await resolveTwilioCreds(this.dataSource, call.account_id);
    } catch (err) {
      if (err instanceof TwilioConfigError) {
        this.logger.warn(`twilio creds missing for account=${call.account_id}`);
        return;
      }
      throw err;
    }

    const stored = await this.downloadAndStore({
      accountSid: creds.accountSid,
      authToken: creds.authToken,
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
      accountId: call.account_id,
      callSid: params.callSid,
      recordingSid: params.recordingSid,
    });

    await this.dataSource.query(
      `SELECT public.voice_call_persist_recording($1, $2, $3, $4, $5)`,
      [
        call.id,
        params.recordingSid,
        params.durationSec,
        stored?.storagePath ?? null,
        stored?.signedUrl ?? null,
      ],
    );

    if (stored) {
      try {
        await this.transcribeVoice(call.id);
      } catch (err) {
        this.logger.warn(`transcribe invoke failed: ${(err as Error).message}`);
      }
    }
  }

  private async downloadAndStore(params: {
    accountSid: string;
    authToken?: string;
    apiKey?: string;
    apiSecret?: string;
    accountId: string;
    callSid: string;
    recordingSid: string;
  }): Promise<{ storagePath: string; signedUrl: string | null } | null> {
    const user = params.apiKey ?? params.accountSid;
    const pass = params.apiSecret ?? params.authToken ?? '';
    const url = `https://api.twilio.com/2010-04-01/Accounts/${params.accountSid}/Recordings/${params.recordingSid}.mp3`;

    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`,
        },
      });
      if (!res.ok) {
        this.logger.error(`recording download failed ${res.status}`);
        return null;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const ym = new Date().toISOString().slice(0, 7);
      const key = `${params.accountId}/${ym}/${params.callSid}.mp3`;

      await this.storage.uploadObject(BUCKET, key, buf, 'audio/mpeg');
      const signedUrl = await this.storage.presignDownload(
        key,
        BUCKET,
        SIGNED_URL_TTL_SECONDS,
      );

      return { storagePath: `${BUCKET}/${key}`, signedUrl };
    } catch (err) {
      this.logger.error(`persist recording failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** Ported from supabase/functions/transcribe-voice. */
  async transcribeVoice(voiceCallId: string): Promise<ToolResponse> {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) return fail('DEEPGRAM_API_KEY not configured', 503);

    const rows = await this.dataSource.query<
      {
        id: string;
        account_id: string;
        recording_storage_path: string | null;
        transcription_status: string | null;
        metadata: Record<string, unknown> | null;
      }[]
    >(`SELECT * FROM public.voice_call_get_for_transcription($1)`, [
      voiceCallId,
    ]);
    const call = rows[0];
    if (!call) return fail('voice_call not found', 404);
    if (!call.recording_storage_path)
      return fail('no recording to transcribe', 400);
    if (call.transcription_status === 'done') {
      return ok({ skipped: true, reason: 'already transcribed' });
    }

    await this.dataSource.query(
      `SELECT public.voice_call_set_transcription_status($1, 'processing')`,
      [voiceCallId],
    );

    const [bucket, ...rest] = call.recording_storage_path.split('/');
    const key = rest.length ? rest.join('/') : call.recording_storage_path;
    const signBucket = rest.length ? bucket : BUCKET;

    let signedUrl: string;
    try {
      signedUrl = await this.storage.presignDownload(
        key,
        signBucket,
        DEEPGRAM_SIGN_TTL_SECONDS,
      );
    } catch (err) {
      await this.dataSource.query(
        `SELECT public.voice_call_set_transcription_failed($1, $2)`,
        [voiceCallId, 'could not sign recording URL'],
      );
      this.logger.error(`sign URL failed: ${(err as Error).message}`);
      return fail('sign URL failed', 500);
    }

    try {
      const result = await this.transcribeRemote(apiKey, signedUrl);

      await this.dataSource.query(
        `SELECT public.voice_call_set_transcription_done($1, $2::jsonb, $3::jsonb)`,
        [
          voiceCallId,
          JSON.stringify(result.utterances),
          JSON.stringify({
            ...(call.metadata ?? {}),
            transcription_summary: {
              full_text_length: result.transcriptText.length,
              duration_sec: result.durationSec,
              language: result.language,
            },
          }),
        ],
      );

      return ok({ utterances: result.utterances.length });
    } catch (err) {
      await this.dataSource.query(
        `SELECT public.voice_call_set_transcription_failed($1, $2)`,
        [voiceCallId, (err as Error).message.slice(0, 500)],
      );
      this.logger.error(`deepgram failed: ${(err as Error).message}`);
      return fail((err as Error).message, 500);
    }
  }

  private async transcribeRemote(
    apiKey: string,
    audioUrl: string,
  ): Promise<DeepgramResult> {
    const qs = new URLSearchParams({
      model: 'nova-3',
      language: 'pt',
      diarize: 'true',
      punctuate: 'true',
      smart_format: 'true',
      utterances: 'true',
    });

    const res = await fetch(
      `https://api.deepgram.com/v1/listen?${qs.toString()}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: audioUrl }),
      },
    );
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(`Deepgram ${res.status}: ${msg}`);
    }
    const j = (await res.json()) as {
      results?: {
        channels?: {
          alternatives?: { transcript?: string; language?: string }[];
        }[];
        utterances?: {
          speaker?: number;
          start: number;
          end: number;
          transcript: string;
          confidence: number;
        }[];
      };
      metadata?: { duration?: number };
    };

    const alt = j.results?.channels?.[0]?.alternatives?.[0];
    const transcriptText = alt?.transcript ?? '';
    const utterances = (j.results?.utterances ?? []).map((u) => ({
      speaker: u.speaker ?? 0,
      start: u.start,
      end: u.end,
      transcript: u.transcript,
      confidence: u.confidence,
    }));

    return {
      transcriptText,
      utterances,
      language: alt?.language,
      durationSec: j.metadata?.duration,
    };
  }
}

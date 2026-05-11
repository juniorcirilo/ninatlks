// Transcribe a voice_calls row using Deepgram.
// Input: { voice_call_id: uuid }
// Flow:
//   1. Load row + ensure transcription_status != 'done'
//   2. Sign the storage path (1h TTL) so Deepgram can fetch it
//   3. POST to Deepgram /v1/listen with diarization + utterances
//   4. Store transcript array into voice_calls.transcript; flip status to done
//
// Called by:
//   - twilio-recording-callback (fire-and-forget after recording lands)
//   - manual retry via UI (pass voice_call_id)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { deepgram, recordings as twilioRecordings } from "../_shared/twilio/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const apiKey = Deno.env.get("DEEPGRAM_API_KEY");
    if (!apiKey) return j({ error: "DEEPGRAM_API_KEY not configured" }, 503);

    const body = await req.json();
    const voiceCallId: string | undefined = body.voice_call_id;
    if (!voiceCallId) return j({ error: "voice_call_id required" }, 400);

    const { data: call, error } = await admin
      .from("voice_calls")
      .select(
        "id, account_id, recording_storage_path, recording_sid, transcription_status, metadata",
      )
      .eq("id", voiceCallId)
      .maybeSingle();
    if (error || !call) return j({ error: "voice_call not found" }, 404);
    if (!call.recording_storage_path) return j({ error: "no recording to transcribe" }, 400);
    if (call.transcription_status === "done") {
      return j({ skipped: true, reason: "already transcribed" });
    }

    await admin
      .from("voice_calls")
      .update({ transcription_status: "processing" })
      .eq("id", voiceCallId);

    const signed = await twilioRecordings.signRecordingUrl(
      admin,
      call.recording_storage_path,
      60 * 60,
    );
    if (!signed) {
      await admin
        .from("voice_calls")
        .update({
          transcription_status: "failed",
          transcription_error: "could not sign recording URL",
        })
        .eq("id", voiceCallId);
      return j({ error: "sign URL failed" }, 500);
    }

    try {
      const result = await deepgram.transcribeRemote({
        apiKey,
        audioUrl: signed,
        options: { language: "pt", diarize: true, utterances: true, smartFormat: true },
      });

      await admin
        .from("voice_calls")
        .update({
          transcript: result.utterances,
          transcription_status: "done",
          transcription_provider: "deepgram",
          transcription_completed_at: new Date().toISOString(),
          metadata: {
            ...(call.metadata ?? {}),
            transcription_summary: {
              full_text_length: result.transcriptText.length,
              duration_sec: result.durationSec,
              language: result.language,
            },
          },
        })
        .eq("id", voiceCallId);

      return j({ ok: true, utterances: result.utterances.length });
    } catch (dgErr) {
      await admin
        .from("voice_calls")
        .update({
          transcription_status: "failed",
          transcription_error: String(dgErr).slice(0, 500),
        })
        .eq("id", voiceCallId);
      throw dgErr;
    }
  } catch (err) {
    console.error("[transcribe-voice] failed", err);
    return j({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

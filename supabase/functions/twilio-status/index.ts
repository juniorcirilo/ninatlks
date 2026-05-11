// Webhook público chamado pelo Twilio em status callbacks
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  getPublicUrl,
  isWebhookVerificationDisabled,
  validateTwilioSignature,
} from "../_shared/webhook-security.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

const STATUS_MAP: Record<string, string> = {
  queued: "queued",
  initiated: "queued",
  ringing: "ringing",
  "in-progress": "in_progress",
  completed: "completed",
  busy: "busy",
  failed: "failed",
  "no-answer": "no_answer",
  canceled: "canceled",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
    const formData = await req.formData();

    if (!isWebhookVerificationDisabled()) {
      const ok = await validateTwilioSignature({
        url: getPublicUrl(req),
        form: formData,
        signature: req.headers.get("x-twilio-signature"),
        authToken,
      });
      if (!ok) {
        return new Response("Forbidden", { status: 403, headers: corsHeaders });
      }
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const callSid = formData.get("CallSid")?.toString() ?? "";
    const callStatus = formData.get("CallStatus")?.toString() ?? "";
    const duration = parseInt(formData.get("CallDuration")?.toString() ?? "0", 10);
    const recordingUrl = formData.get("RecordingUrl")?.toString();

    if (!callSid) {
      return new Response("missing CallSid", { status: 400, headers: corsHeaders });
    }

    const mapped = STATUS_MAP[callStatus] ?? "in_progress";
    const updates: Record<string, unknown> = { status: mapped };
    if (duration > 0) updates.duration_seconds = duration;
    if (recordingUrl) updates.recording_url = recordingUrl;
    if (mapped === "completed" || mapped === "failed" || mapped === "busy" || mapped === "no_answer" || mapped === "canceled") {
      updates.ended_at = new Date().toISOString();
    }

    const { data: updated, error } = await supabase
      .from("voice_calls")
      .update(updates)
      .eq("provider_call_sid", callSid)
      .select("id, recording_storage_path, transcription_status")
      .maybeSingle();

    if (error) console.error("[twilio-status] update error", error);

    // If Twilio delivered a RecordingUrl inline (older config paths may not
    // use RecordingStatusCallback), schedule transcription the same way the
    // recording callback does.
    if (
      updated &&
      recordingUrl &&
      !updated.recording_storage_path &&
      updated.transcription_status === "idle"
    ) {
      // We can't download without creds resolved from phone_number_id; the
      // RecordingStatusCallback is the canonical path. Mark pending so a
      // manual retry via UI can reprocess.
      await supabase
        .from("voice_calls")
        .update({ transcription_status: "pending" })
        .eq("id", updated.id);
    }

    return new Response("ok", { headers: corsHeaders });
  } catch (e) {
    console.error("[twilio-status] error", e);
    return new Response("error", { status: 500, headers: corsHeaders });
  }
});

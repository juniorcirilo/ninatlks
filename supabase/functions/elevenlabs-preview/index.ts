// Generate a short TTS preview of a voice. Used by the persona editor UI
// "Test synthesis" button so users can hear the clone before saving.
//
// Input: { text: string; voice_id: string; voice_settings?: {...} }
// Output: audio/mpeg blob (mp3)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import {
  authErrorResponse,
  requireAuth,
} from "../_shared/auth.ts";
import {
  ElevenLabsError,
  resolveCredentialsForAccount,
  tts,
} from "../_shared/elevenlabs/index.ts";
import { loggerFor } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_CHARS = 500; // cap preview length to protect quota

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);
  const log = loggerFor(req, { function: "elevenlabs-preview" });

  try {
    const ctx = await requireAuth(req);
    const body = await req.json();
    const text: string = String(body.text ?? "").slice(0, MAX_CHARS).trim();
    const voiceId: string = String(body.voice_id ?? "");
    if (!text || !voiceId) return j({ error: "text and voice_id required" }, 400);

    const accountId = ctx.accountIds[0];
    const creds = await resolveCredentialsForAccount(ctx.adminClient, accountId);
    const blob = await tts.synthesize(creds, {
      voiceId,
      text,
      voiceSettings: body.voice_settings,
      outputFormat: "mp3_44100_128",
      modelId: body.model_id,
      languageCode: body.language_code,
    });

    // Log usage
    await ctx.adminClient.from("elevenlabs_usage_log").insert({
      account_id: accountId,
      voice_id: voiceId,
      character_count: text.length,
      model_id: body.model_id ?? "eleven_multilingual_v2",
      purpose: "preview",
    });

    const buf = await blob.arrayBuffer();
    return new Response(buf, {
      headers: {
        ...corsHeaders,
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const authed = authErrorResponse(err, corsHeaders);
    if (authed) return authed;
    if (err instanceof ElevenLabsError) return j({ error: err.message }, err.status);
    log.error("preview failed", err);
    return j({ error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

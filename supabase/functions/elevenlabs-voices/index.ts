// Voice library CRUD proxy.
// GET  → list voices accessible on the account's plan
// PATCH {voice_id, settings} → update voice_settings (stability/similarity_boost/etc)
// DELETE {voice_id} → delete voice (only custom voices; admin only)
//
// Also exposes GET subscription + usage for UI dashboards.
//
// Credentials: resolves the ElevenLabs API key from the caller's account vault
// first, falling back to the global ELEVENLABS_API_KEY env. This way the
// onboarding wizard's saved key is honored without forcing every workspace to
// share the same key.

import {
  authErrorResponse,
  requireAuth,
} from "../_shared/auth.ts";
import {
  ElevenLabsError,
  resolveCredentialsForAccount,
  usage,
  voices as voicesApi,
} from "../_shared/elevenlabs/index.ts";
import { loggerFor } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const log = loggerFor(req, { function: "elevenlabs-voices" });

  try {
    const ctx = await requireAuth(req);
    const accountId = ctx.accountIds[0];
    const creds = await resolveCredentialsForAccount(ctx.adminClient, accountId);

    if (req.method === "GET") {
      const url = new URL(req.url);
      const want = url.searchParams.get("include") ?? "voices,subscription";
      const out: Record<string, any> = {};
      if (want.includes("voices")) {
        out.voices = await voicesApi.listVoices(creds);
      }
      if (want.includes("subscription")) {
        out.subscription = await usage.getSubscription(creds);
      }
      return j(out);
    }

    if (req.method === "PATCH") {
      const body = await req.json();
      const vid = String(body.voice_id ?? "");
      if (!vid) return j({ error: "voice_id required" }, 400);
      const updated = await voicesApi.updateVoiceSettings(creds, vid, body.settings ?? {});
      return j(updated);
    }

    if (req.method === "DELETE") {
      const body = await req.json();
      const vid = String(body.voice_id ?? "");
      if (!vid) return j({ error: "voice_id required" }, 400);

      // Admin-only
      const { data: role } = await ctx.adminClient
        .from("user_roles")
        .select("role")
        .eq("user_id", ctx.userId)
        .eq("account_id", accountId)
        .maybeSingle();
      if (!role || role.role !== "admin") return j({ error: "admin role required" }, 403);

      await voicesApi.deleteVoice(creds, vid);

      // Scrub voice_clone_id from any personas referencing it so we don't
      // try to speak with a vanished voice.
      await ctx.adminClient
        .from("agent_personas")
        .update({ voice_clone_id: null, voice_provider: null })
        .eq("voice_clone_id", vid)
        .in("account_id", ctx.accountIds);

      return j({ deleted: vid });
    }

    return j({ error: "method not allowed" }, 405);
  } catch (err) {
    const authed = authErrorResponse(err, corsHeaders);
    if (authed) return authed;
    if (err instanceof ElevenLabsError) return j({ error: err.message }, err.status);
    log.error("voices op failed", err);
    return j({ error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

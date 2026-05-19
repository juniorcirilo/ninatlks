// Read-only proxy: fetches a single ElevenLabs Conversational AI agent's
// public config (language, voice, model, first_message) so the UI can show
// "this is what's actually live on EL" without exposing the API key.
//
// GET ?agent_id=agent_xxx
//
// Returns: { agent_id, name, language, voice_id, model_id, first_message, found: boolean }

import { authErrorResponse, requireAuth } from "../_shared/auth.ts";
import {
  ElevenLabsError,
  elevenRequest,
  resolveCredentialsForAccount,
} from "../_shared/elevenlabs/index.ts";
import { loggerFor } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const j = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const log = loggerFor(req, { function: "elevenlabs-agent-info" });

  if (req.method !== "GET") return j({ error: "method_not_allowed" }, 405);

  try {
    const ctx = await requireAuth(req);
    const accountId = ctx.accountIds[0];
    if (!accountId) return j({ error: "no_account" }, 403);

    const url = new URL(req.url);
    const agentId = (url.searchParams.get("agent_id") ?? "").trim();
    if (!agentId) return j({ error: "agent_id required" }, 400);

    const creds = await resolveCredentialsForAccount(ctx.adminClient, accountId);

    try {
      const data = await elevenRequest<any>({
        method: "GET",
        path: `/v1/convai/agents/${encodeURIComponent(agentId)}`,
        credentials: creds,
      });
      const cfg = data?.conversation_config ?? {};
      const agentCfg = cfg?.agent ?? {};
      const tts = cfg?.tts ?? {};
      return j({
        agent_id: agentId,
        found: true,
        name: data?.name ?? null,
        language: agentCfg?.language ?? null,
        first_message: agentCfg?.first_message ?? null,
        model_id: tts?.model_id ?? null,
        voice_id: tts?.voice_id ?? null,
      });
    } catch (e) {
      if (e instanceof ElevenLabsError && e.status === 404) {
        return j({ agent_id: agentId, found: false });
      }
      throw e;
    }
  } catch (e) {
    const authResp = authErrorResponse(e, corsHeaders);
    if (authResp) return authResp;
    log.error("agent-info failed", { error: e instanceof Error ? e.message : String(e) });
    const status = e instanceof ElevenLabsError ? (e.status >= 400 && e.status < 600 ? e.status : 502) : 500;
    return j({ error: e instanceof Error ? e.message : "internal_error" }, status);
  }
});

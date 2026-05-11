// TwiML endpoint for outbound campaign calls.
// Twilio fetches this URL when the callee answers. We return either:
//   - <Connect><Stream>  → voice runtime (conversational + hybrid)
//   - <Say>...<Hangup/>  → script-readback (cheapest, no LLM during call)
//
// Includes escalation-ready <Dial> fallback triggered by voice_call metadata.
// Query: ?voice_call_id=<uuid>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

function twiml(body: string) {
  return new Response(body, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "text/xml; charset=utf-8" },
  });
}

function hangup(reason: string) {
  return twiml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="pt-BR">${escapeXml(reason)}</Say>
  <Hangup/>
</Response>`);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderTemplate(tpl: string, vars: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null ? "" : String(v);
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // Twilio always POSTs form-encoded. Some setups use GET. Accept both.
  const url = new URL(req.url);
  const voiceCallId = url.searchParams.get("voice_call_id") ?? "";
  if (!voiceCallId) return hangup("Parametros invalidos");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: call } = await supabase
    .from("voice_calls")
    .select("id, account_id, persona_id, metadata")
    .eq("id", voiceCallId)
    .maybeSingle();
  if (!call) return hangup("Chamada nao encontrada.");

  const meta = (call.metadata ?? {}) as Record<string, any>;
  const mode = meta.script_mode ?? "conversational";
  const vars = (meta.variables ?? {}) as Record<string, unknown>;

  // Compliance disclaimer — account setting with campaign override.
  let disclaimerText: string | null = null;
  {
    const { data: campaign } = meta.campaign_id
      ? await supabase
          .from("voice_campaigns")
          .select("disclaimer_enabled")
          .eq("id", meta.campaign_id)
          .maybeSingle()
      : { data: null };
    const campaignSaysOn = !campaign || campaign.disclaimer_enabled !== false;
    if (campaignSaysOn) {
      const { data: account } = await supabase
        .from("accounts")
        .select("internal_attributes")
        .eq("id", call.account_id)
        .maybeSingle();
      disclaimerText =
        (account?.internal_attributes as any)?.compliance?.recording_disclaimer ??
        "Esta ligação está sendo gravada para fins de qualidade. Ao permanecer na chamada, você concorda com a gravação.";
    }
  }
  const disclaimerTwiml = disclaimerText
    ? `<Say language="pt-BR" voice="Polly.Camila">${escapeXml(disclaimerText)}</Say><Pause length="1"/>`
    : "";

  // Readback: pure TTS of a fixed script — no LLM runtime. Cheapest path.
  if (mode === "script_readback") {
    const raw = String(meta.opening_script ?? "");
    const text = renderTemplate(raw, vars) || "Olá, tudo bem?";
    return twiml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${disclaimerTwiml}
  <Say language="pt-BR" voice="Polly.Camila">${escapeXml(text)}</Say>
  <Pause length="1"/>
  <Say language="pt-BR" voice="Polly.Camila">Obrigado pela atenção. Até logo.</Say>
  <Hangup/>
</Response>`);
  }

  // Conversational / hybrid: hand the audio stream to voice-runtime.
  const wsHost = Deno.env.get("VOICE_WS_HOST");
  if (!wsHost) {
    return hangup("Servico de voz nao configurado.");
  }

  const params = new URLSearchParams({
    callId: call.id,
    accountId: call.account_id,
    mode: "campaign",
  });
  if (call.persona_id) params.set("personaId", call.persona_id);
  if (meta.campaign_id) params.set("campaignId", meta.campaign_id);
  if (meta.voice_id) params.set("voiceId", meta.voice_id);
  if (meta.opening_script) {
    const rendered = renderTemplate(String(meta.opening_script), vars);
    params.set("opening", rendered.slice(0, 500));
  }

  const streamUrl = `wss://${wsHost}/api/voice/twilio/stream?${params.toString()}`;
  return twiml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${disclaimerTwiml}
  <Connect>
    <Stream url="${streamUrl}">
      <Parameter name="callId" value="${call.id}"/>
      <Parameter name="accountId" value="${call.account_id}"/>
      <Parameter name="mode" value="campaign"/>
      ${meta.campaign_id ? `<Parameter name="campaignId" value="${meta.campaign_id}"/>` : ""}
    </Stream>
  </Connect>
</Response>`);
});

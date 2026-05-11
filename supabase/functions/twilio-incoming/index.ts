// Webhook público chamado pelo Twilio quando uma chamada entra (ou sai
// como outbound-api). Retorna TwiML conforme inbound_behavior do número.
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

const VOICEMAIL_TWIML = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="pt-BR" voice="Polly.Camila">No momento não podemos atender. Deixe seu recado após o sinal.</Say>
  <Record maxLength="120" playBeep="true" />
  <Hangup/>
</Response>`;

const BUSY_TWIML = `<?xml version="1.0" encoding="UTF-8"?>
<Response><Say language="pt-BR" voice="Polly.Camila">Desculpe, todos os atendentes estão ocupados.</Say><Hangup/></Response>`;

// ── ElevenLabs helpers ────────────────────────────────────────────

async function resolveElAgentId(
  supabase: any,
  personaId: string | null,
): Promise<string | null> {
  if (!personaId) return null;
  const { data } = await supabase
    .from("agent_personas")
    .select("elevenlabs_agent_id")
    .eq("id", personaId)
    .maybeSingle();
  return (data?.elevenlabs_agent_id as string | null) ?? null;
}

async function buildElTwiML(
  elAgentId: string,
  from: string,
  _to: string,
  direction: string,
  callId: string,
  _callSid: string,
): Promise<string> {
  const apiKey = Deno.env.get("ELEVENLABS_API_KEY") ?? "";
  if (!apiKey) {
    console.warn("[twilio-incoming] ELEVENLABS_API_KEY not set");
    return VOICEMAIL_TWIML;
  }

  try {
    // EL's documented flow for Twilio Media Streams:
    //   1. GET /v1/convai/conversation/get_signed_url?agent_id=X returns a
    //      pre-authenticated WSS URL (signed, expires in ~30 min).
    //   2. Embed that URL inside <Connect><Stream url="wss://..."/></Connect>.
    //   3. Twilio opens the WS; EL authenticates via the signed URL (no
    //      API key exposed to the client side).
    const signedRes = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${encodeURIComponent(elAgentId)}`,
      { headers: { "xi-api-key": apiKey } },
    );
    if (!signedRes.ok) {
      const txt = await signedRes.text().catch(() => "");
      console.error(
        `[twilio-incoming] EL get_signed_url failed ${signedRes.status}: ${txt.slice(0, 300)}`,
      );
      return VOICEMAIL_TWIML;
    }
    const signed = await signedRes.json().catch(() => null);
    const wssUrl: string | undefined = signed?.signed_url ?? signed?.url;
    if (!wssUrl) {
      console.warn(
        `[twilio-incoming] EL get_signed_url shape unexpected: ${JSON.stringify(signed).slice(0, 200)}`,
      );
      return VOICEMAIL_TWIML;
    }

    // Use the signed URL VERBATIM — appending extra params invalidates the
    // conversation_signature EL embeds in it and the WS closes right after
    // Twilio connects (Twilio error 31921). Call metadata travels via
    // <Parameter> tags inside <Stream>, which Twilio forwards on the
    // "start" event.
    console.log(
      `[twilio-incoming] EL signed URL obtained agent=${elAgentId} direction=${direction}`,
    );

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeXml(wssUrl)}">
      <Parameter name="agent_id" value="${escapeXml(elAgentId)}"/>
      <Parameter name="call_id" value="${escapeXml(callId)}"/>
      <Parameter name="caller_id" value="${escapeXml(from)}"/>
    </Stream>
  </Connect>
</Response>`;
  } catch (err) {
    console.error("[twilio-incoming] EL buildTwiML exception", err);
    return VOICEMAIL_TWIML;
  }
}

// ── ConversationRelay fallback ─────────────────────────────────────

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case '"': return "&quot;";
      case "'": return "&apos;";
      default: return c;
    }
  });
}

function buildAiAnswerTwiML(
  callId: string,
  personaId: string | null,
  voiceId: string,
  welcomeGreeting: string,
) {
  // Twilio <ConversationRelay>: Twilio hosts STT (Deepgram) + TTS (ElevenLabs)
  // and forwards transcribed turns to our edge function over WebSocket.
  // See supabase/functions/twilio-conversation-relay/index.ts for the handler.
  //
  // welcomeGreeting is spoken immediately on call connect — required for
  // outbound because the customer picks up and won't speak first. For inbound
  // it works as the opening line.
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const wsHost = supabaseUrl.replace(/^https:\/\//, "");
  if (!wsHost) return VOICEMAIL_TWIML;

  const wsUrl = `wss://${wsHost}/functions/v1/twilio-conversation-relay?callId=${encodeURIComponent(callId)}`;
  const greet = escapeXml(welcomeGreeting);

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay
      url="${wsUrl}"
      welcomeGreeting="${greet}"
      ttsProvider="ElevenLabs"
      transcriptionProvider="Deepgram"
      voice="${voiceId}"
      language="pt-BR"
      ttsLanguage="pt-BR"
      transcriptionLanguage="pt-BR"
      speechModel="nova-3-general"
      interruptible="any"
      dtmfDetection="true">
      <Parameter name="callId" value="${callId}"/>
      ${personaId ? `<Parameter name="personaId" value="${personaId}"/>` : ""}
    </ConversationRelay>
  </Connect>
</Response>`;
}

// Default pt-BR voice when persona hasn't pinned one. Allow override via env.
const DEFAULT_VOICE_ID = () =>
  Deno.env.get("ELEVENLABS_DEFAULT_VOICE_ID") ?? "UgBBYS2sOqTuMpoF3BR0";

function buildForwardTwiML(forwardTo: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="pt-BR" voice="Polly.Camila">Transferindo sua ligação, um momento.</Say>
  <Dial timeout="30">${forwardTo}</Dial>
</Response>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
    const formData = await req.formData();

    // HMAC: Twilio signs url + sorted POST params. The request arrives at
    // our edge function via Supabase's proxy, where req.url has a different
    // host than the URL Twilio was configured with. Try the reconstructed
    // URL first, fall back to the canonical SUPABASE_URL-based one.
    if (!isWebhookVerificationDisabled()) {
      const signature = req.headers.get("x-twilio-signature");
      const supabaseBase = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
      const canonicalUrl = `${supabaseBase}/functions/v1/twilio-incoming`;
      const candidates = [getPublicUrl(req), canonicalUrl];
      let matched = false;
      for (const url of candidates) {
        const ok = await validateTwilioSignature({ url, form: formData, signature, authToken });
        if (ok) {
          matched = true;
          break;
        }
      }
      if (!matched) {
        console.warn(
          `[twilio-incoming] HMAC mismatch. tried=${candidates.join(",")} sig=${signature?.slice(0, 16)}…`,
        );
        return new Response("Forbidden", { status: 403, headers: corsHeaders });
      }
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const callSid = formData.get("CallSid")?.toString() ?? "";
    const from = formData.get("From")?.toString() ?? "";
    const to = formData.get("To")?.toString() ?? "";
    const direction = formData.get("Direction")?.toString() ?? "inbound";

    // For inbound calls (customer → us), our Twilio number is `To`.
    // For outbound-api calls (we dial customer), our Twilio number is `From`.
    const ownE164 = direction.startsWith("outbound") ? from : to;

    console.log(
      `[twilio-incoming] callSid=${callSid} direction=${direction} from=${from} to=${to} ownE164=${ownE164}`,
    );

    const { data: phoneNumber, error: phoneErr } = await supabase
      .from("phone_numbers")
      .select("id, account_id, inbox_id, pinned_persona_id, inbound_behavior, enabled, provider_config")
      .eq("e164", ownE164)
      .maybeSingle();
    console.log(
      `[twilio-incoming] phone_number lookup: found=${!!phoneNumber} enabled=${phoneNumber?.enabled} behavior=${phoneNumber?.inbound_behavior} persona=${phoneNumber?.pinned_persona_id} err=${phoneErr?.message ?? "none"}`,
    );

    if (phoneErr || !phoneNumber || !phoneNumber.enabled) {
      return new Response(BUSY_TWIML, {
        headers: { "Content-Type": "text/xml; charset=utf-8" },
      });
    }

    // For outbound-api, voice-outbound already created the voice_calls row
    // before dialing. Look it up by CallSid to avoid duplicating.
    let call: { id: string } | null = null;
    if (direction.startsWith("outbound")) {
      const { data: existing } = await supabase
        .from("voice_calls")
        .select("id")
        .eq("provider_call_sid", callSid)
        .maybeSingle();
      if (existing) call = existing;
    }

    if (!call) {
      const { data: created } = await supabase
        .from("voice_calls")
        .insert({
          account_id: phoneNumber.account_id,
          phone_number_id: phoneNumber.id,
          persona_id: phoneNumber.pinned_persona_id,
          direction: direction.startsWith("outbound") ? "outbound" : "inbound",
          status: "ringing",
          provider: "twilio",
          provider_call_sid: callSid,
          from_number: from,
          to_number: to,
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      call = created;
    }

    const callId = call?.id ?? callSid;
    const cfg = (phoneNumber.provider_config ?? {}) as Record<string, unknown>;
    const forwardTo = typeof cfg.forward_to === "string" ? cfg.forward_to : "";

    // Resolve voice + greeting for this call. Both come from the pinned
    // persona when available; env provides defaults for the trial case.
    let voiceId = DEFAULT_VOICE_ID();
    if (typeof cfg.voice_id === "string" && cfg.voice_id) {
      voiceId = cfg.voice_id;
    }
    let welcomeGreeting = "Olá, em que posso ajudar?";
    if (phoneNumber.pinned_persona_id) {
      const { data: persona } = await supabase
        .from("agent_personas")
        .select("name, voice_clone_id, voice_provider")
        .eq("id", phoneNumber.pinned_persona_id)
        .maybeSingle();
      if (persona) {
        if (persona.voice_provider === "elevenlabs" && persona.voice_clone_id) {
          voiceId = persona.voice_clone_id;
        }
        if (persona.name) {
          welcomeGreeting = `Olá! Aqui é ${persona.name}. Em que posso ajudar?`;
        }
      }
    }

    let twiml: string;
    switch (phoneNumber.inbound_behavior) {
      case "ai_answer":
      case "suggest": {
        // Prefer ElevenLabs Conversational AI if the persona has a synced agent.
        const elAgentId = await resolveElAgentId(supabase, phoneNumber.pinned_persona_id);
        if (elAgentId) {
          twiml = await buildElTwiML(elAgentId, from, to, direction, callId, callSid);
        } else {
          // Fallback: ConversationRelay (Twilio-hosted STT+TTS).
          twiml = buildAiAnswerTwiML(callId, phoneNumber.pinned_persona_id, voiceId, welcomeGreeting);
        }
        break;
      }
      case "forward_to_agent":
        twiml = forwardTo ? buildForwardTwiML(forwardTo) : VOICEMAIL_TWIML;
        break;
      case "voicemail":
      default:
        twiml = VOICEMAIL_TWIML;
        break;
    }
    console.log(
      `[twilio-incoming] emitting TwiML (${phoneNumber.inbound_behavior}, voice=${voiceId}, callId=${callId}):\n${twiml.slice(0, 500)}`,
    );

    return new Response(twiml, {
      headers: { ...corsHeaders, "Content-Type": "text/xml; charset=utf-8" },
    });
  } catch (e) {
    console.error("[twilio-incoming] error", e);
    return new Response(BUSY_TWIML, {
      headers: { ...corsHeaders, "Content-Type": "text/xml; charset=utf-8" },
    });
  }
});

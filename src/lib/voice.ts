/**
 * Voice runtime — phone numbers + voice calls + outbound dialer
 */
import { supabase } from "@/integrations/supabase/client";

export type InboundBehavior = "ai_answer" | "suggest" | "forward_to_agent" | "voicemail";
export type CallDirection = "inbound" | "outbound";
export type CallStatus =
  | "queued"
  | "ringing"
  | "in_progress"
  | "completed"
  | "busy"
  | "failed"
  | "no_answer"
  | "canceled";

export interface PhoneNumber {
  id: string;
  account_id: string;
  e164: string;
  friendly_name: string | null;
  provider: string;
  provider_config: Record<string, unknown>;
  inbox_id: string | null;
  pinned_persona_id: string | null;
  inbound_behavior: InboundBehavior;
  outbound_enabled: boolean;
  enabled: boolean;
  // When set, inbound+outbound are handled by the EL native Twilio
  // integration: api.elevenlabs.io/twilio/inbound_call for inbound and
  // POST /v1/convai/twilio/outbound-call for outbound. Twilio's own
  // Voice webhook is overwritten by EL on registration.
  elevenlabs_phone_number_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface VoiceCall {
  id: string;
  account_id: string;
  phone_number_id: string | null;
  conversation_id: string | null;
  persona_id: string | null;
  handled_by_user_id: string | null;
  direction: CallDirection;
  status: CallStatus;
  provider: string;
  provider_call_sid: string | null;
  from_number: string;
  to_number: string;
  duration_seconds: number;
  total_cost_cents: number;
  recording_url: string | null;
  transcript: Array<{ role: string; content: string; at?: string }>;
  metadata: Record<string, unknown>;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export const INBOUND_LABELS: Record<InboundBehavior, string> = {
  ai_answer: "IA atende",
  suggest: "IA sugere (humano envia)",
  forward_to_agent: "Encaminhar pro humano",
  voicemail: "Correio de voz",
};

export const STATUS_LABELS: Record<CallStatus, string> = {
  queued: "Na fila",
  ringing: "Chamando",
  in_progress: "Em andamento",
  completed: "Concluída",
  busy: "Ocupado",
  failed: "Falhou",
  no_answer: "Sem resposta",
  canceled: "Cancelada",
};

export const STATUS_TONE: Record<CallStatus, "neutral" | "active" | "good" | "bad"> = {
  queued: "neutral",
  ringing: "active",
  in_progress: "active",
  completed: "good",
  busy: "bad",
  failed: "bad",
  no_answer: "bad",
  canceled: "neutral",
};

// ── Phone numbers CRUD ──────────────────────────────────────────────
export async function fetchPhoneNumbers(accountId: string) {
  const { data, error } = await supabase
    .from("phone_numbers")
    .select("*")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as PhoneNumber[];
}

export async function createPhoneNumber(input: {
  accountId: string;
  e164: string;
  friendlyName?: string;
  inboxId?: string | null;
  pinnedPersonaId?: string | null;
  inboundBehavior?: InboundBehavior;
}) {
  const { data, error } = await supabase
    .from("phone_numbers")
    .insert({
      account_id: input.accountId,
      e164: input.e164,
      friendly_name: input.friendlyName ?? null,
      inbox_id: input.inboxId ?? null,
      pinned_persona_id: input.pinnedPersonaId ?? null,
      inbound_behavior: input.inboundBehavior ?? "ai_answer",
    } as never)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as PhoneNumber;
}

export async function updatePhoneNumber(id: string, updates: Partial<PhoneNumber>) {
  const { data, error } = await supabase
    .from("phone_numbers")
    .update(updates as never)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as PhoneNumber;
}

export async function deletePhoneNumber(id: string) {
  const { error } = await supabase.from("phone_numbers").delete().eq("id", id);
  if (error) throw error;
}

// ── Voice calls ─────────────────────────────────────────────────────
export async function fetchVoiceCalls(accountId: string, limit = 50) {
  const { data, error } = await supabase
    .from("voice_calls")
    .select("*")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as VoiceCall[];
}

export async function fetchVoiceCall(id: string) {
  const { data, error } = await supabase
    .from("voice_calls")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as VoiceCall | null;
}

// ── Outbound dialer ─────────────────────────────────────────────────

export type PlaceCallReason =
  | "invalid_e164"
  | "dnc"
  | "outside_allowed_hours"
  | "outside_allowed_day"
  | "too_soon"
  | "max_attempts_today"
  | "twilio_not_configured"
  | "twilio_trial_unverified_number"
  | "twilio_call_failed"
  | "rpc_error";

export interface PlaceCallResult {
  ok: boolean;
  callId: string;
  via: "elevenlabs" | "twilio" | "twilio_fallback";
  status?: string;
  reason?: PlaceCallReason | string;
  /** PT-BR pronto pra toast quando ok=false. */
  message?: string;
  twilioCallSid?: string;
  conversationId?: string;
}

/**
 * Cliente unificado de discagem. Decide a rota baseado em
 * `phone_numbers.elevenlabs_phone_number_id`:
 *   - se setado → elevenlabs-outbound-call (com fallback automático Twilio em 5xx)
 *   - senão     → voice-outbound (Twilio direto)
 *
 * Sempre retorna `PlaceCallResult` — bloqueios do guard chegam como
 * `ok: false` com `reason` preenchido pra UI montar toast específico.
 */
export async function placeCall(input: {
  fromNumberId: string;
  toNumber: string;
  personaId?: string;
  contactId?: string;
  notes?: string;
  meetingId?: string;
  callPurpose?: "discovery" | "reminder" | "noshow_reschedule" | "followup";
}): Promise<PlaceCallResult> {
  // Lê info do número pra decidir rota
  const { data: pn } = await supabase
    .from("phone_numbers")
    .select("id, elevenlabs_phone_number_id, pinned_persona_id")
    .eq("id", input.fromNumberId)
    .maybeSingle();

  const useElevenLabs = !!(pn as any)?.elevenlabs_phone_number_id;

  if (useElevenLabs) {
    // Usa fetch direto (em vez de supabase.functions.invoke) pra evitar que
    // 4xx vire FunctionsHttpError com console.error — o que dispara o overlay
    // de runtime-error do Lovable mesmo quando a UI já trata o erro com toast.
    // 422 (guard bloqueou: too_soon, outside_hours, dnc…) é resposta esperada.
    const { data, error } = await invokeEdge("elevenlabs-outbound-call", {
      from_phone_number_id: input.fromNumberId,
      to_number: input.toNumber,
      persona_id: input.personaId,
      contact_id: input.contactId,
      notes: input.notes,
      meeting_id: input.meetingId,
      call_purpose: input.callPurpose,
    });

    if (error) {
      return {
        ok: false,
        callId: "",
        via: "elevenlabs",
        reason: error.reason ?? "rpc_error",
        message: error.message ?? "Falha ao discar",
      };
    }
    const d = data as Record<string, any>;
    if (d?.ok === false || d?.error) {
      return {
        ok: false,
        callId: d?.call_id ?? "",
        via: (d?.via ?? "elevenlabs") as PlaceCallResult["via"],
        reason: d?.reason,
        message: d?.error ?? d?.message,
      };
    }
    return {
      ok: true,
      callId: d.call_id,
      via: (d.via ?? "elevenlabs") as PlaceCallResult["via"],
      twilioCallSid: d.twilio_call_sid,
      conversationId: d.conversation_id,
    };
  }

  // Caminho Twilio direto
  const { data, error } = await invokeEdge("voice-outbound", {
    fromNumberId: input.fromNumberId,
    toNumber: input.toNumber,
    personaId: input.personaId,
    contactId: input.contactId,
    notes: input.notes,
    meetingId: input.meetingId,
    callPurpose: input.callPurpose,
  });
  if (error) {
    return {
      ok: false,
      callId: "",
      via: "twilio",
      reason: error.reason ?? "rpc_error",
      message: error.message ?? "Falha ao discar",
    };
  }
  const d = data as Record<string, any>;
  if (d?.ok === false || d?.error || d?.status === "failed") {
    return {
      ok: false,
      callId: d.callId ?? "",
      via: "twilio",
      reason: d.reason,
      message: d.error ?? d.message,
    };
  }
  return {
    ok: true,
    callId: d.callId,
    via: "twilio",
    twilioCallSid: d.callSid,
    status: d.status,
  };
}

/**
 * Wrapper sobre fetch pra invocar edge functions sem passar pelo
 * supabase.functions.invoke — esse último faz console.error em qualquer 4xx,
 * o que dispara o overlay de runtime-error do Lovable mesmo quando a UI já
 * trata o erro com toast. Aqui 4xx é resposta esperada (guard bloqueando).
 */
async function invokeEdge(
  name: string,
  body: Record<string, unknown>,
): Promise<{ data: unknown; error: { reason?: string; message?: string } | null }> {
  try {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`;
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
    };
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }

    if (!res.ok) {
      return {
        data: null,
        error: {
          reason: parsed?.reason,
          message: parsed?.error ?? parsed?.message ?? `HTTP ${res.status}`,
        },
      };
    }
    return { data: parsed, error: null };
  } catch (e) {
    return {
      data: null,
      error: { message: e instanceof Error ? e.message : "network error" },
    };
  }
}

/** @deprecated use placeCall */
export async function dialOutbound(input: {
  fromNumberId: string;
  toNumber: string;
  personaId?: string;
}) {
  const r = await placeCall(input);
  return {
    callId: r.callId,
    callSid: r.twilioCallSid,
    status: r.ok ? (r.status ?? "queued") : "failed",
    reason: r.reason,
    message: r.message,
  };
}


// ── ElevenLabs native Twilio integration ────────────────────────────

/**
 * Registra o número Twilio no ElevenLabs e o vincula à persona pinada.
 * EL reconfigura o webhook Voice do Twilio pra apontar pra endpoint deles
 * e passa a gerenciar STT/LLM/TTS/RAG de todas as ligações desse número.
 *
 * Pré-requisito: o número tem uma persona pinada e essa persona já foi
 * sincronizada com o ElevenLabs (elevenlabs_agent_id preenchido).
 */
export async function registerPhoneWithElevenLabs(phoneNumberId: string) {
  const { data, error } = await supabase.functions.invoke("elevenlabs-phone-register", {
    body: { phone_number_id: phoneNumberId },
  });
  if (error) throw new Error(error.message || "Falha ao ativar a IA do ElevenLabs neste número");
  const d = data as { ok?: boolean; error?: string; elevenlabs_phone_number_id?: string };
  if (d.error || !d.ok) throw new Error(d.error ?? "Ativação falhou");
  return d;
}

/** @deprecated use placeCall — esta função vai ser removida no próximo sprint. */
export async function dialViaElevenLabs(input: {
  fromPhoneNumberId: string;
  toNumber: string;
  personaId?: string;
}) {
  const r = await placeCall({
    fromNumberId: input.fromPhoneNumberId,
    toNumber: input.toNumber,
    personaId: input.personaId,
  });
  if (!r.ok) throw new Error(r.message ?? "Discagem falhou");
  return {
    ok: true,
    call_id: r.callId,
    conversation_id: r.conversationId,
    twilio_call_sid: r.twilioCallSid,
  };
}

// ── Voice clone ─────────────────────────────────────────────────────
export async function cloneVoiceForPersona(input: {
  personaId: string;
  file: File;
}) {
  const buffer = await input.file.arrayBuffer();
  // Convert to base64 in chunks (avoid stack overflow)
  const bytes = new Uint8Array(buffer);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const audioBase64 = btoa(bin);

  const { data, error } = await supabase.functions.invoke("voice-clone", {
    body: {
      personaId: input.personaId,
      audioBase64,
      filename: input.file.name,
      mimeType: input.file.type,
    },
  });
  if (error) throw error;
  return data as { voiceId: string; personaId: string; provider: string };
}

// ── Webhook URLs (for display in UI) ────────────────────────────────
export function getTwilioWebhookUrls(): { incoming: string; status: string } {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "";
  return {
    incoming: `${supabaseUrl}/functions/v1/twilio-incoming`,
    status: `${supabaseUrl}/functions/v1/twilio-status`,
  };
}

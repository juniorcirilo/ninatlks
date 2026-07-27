/**
 * Voice runtime — phone numbers + voice calls + outbound dialer
 */
import { apiClient, ApiError } from "@/lib/api-client";

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
  recording_storage_path: string | null;
  transcription_status: string | null;
  transcription_error: string | null;
  source_id: string | null;
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

interface PhoneNumberApiRow {
  id: string;
  accountId: string;
  e164: string;
  friendlyName: string | null;
  provider: string;
  providerConfig: Record<string, unknown>;
  inboxId: string | null;
  pinnedPersonaId: string | null;
  inboundBehavior: string;
  outboundEnabled: boolean;
  enabled: boolean;
  elevenlabsPhoneNumberId: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapPhoneNumber(r: PhoneNumberApiRow): PhoneNumber {
  return {
    id: r.id,
    account_id: r.accountId,
    e164: r.e164,
    friendly_name: r.friendlyName,
    provider: r.provider,
    provider_config: r.providerConfig ?? {},
    inbox_id: r.inboxId,
    pinned_persona_id: r.pinnedPersonaId,
    inbound_behavior: r.inboundBehavior as InboundBehavior,
    outbound_enabled: r.outboundEnabled,
    enabled: r.enabled,
    elevenlabs_phone_number_id: r.elevenlabsPhoneNumberId,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

interface VoiceCallApiRow {
  id: string;
  accountId: string;
  phoneNumberId: string | null;
  conversationId: string | null;
  personaId: string | null;
  handledByUserId: string | null;
  direction: string;
  status: string;
  provider: string;
  providerCallSid: string | null;
  fromNumber: string;
  toNumber: string;
  durationSeconds: number;
  totalCostCents: number;
  recordingUrl: string | null;
  transcript: unknown;
  metadata: Record<string, unknown>;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  recordingStoragePath: string | null;
  transcriptionStatus: string | null;
  transcriptionError: string | null;
  sourceId: string | null;
}

function mapVoiceCall(r: VoiceCallApiRow): VoiceCall {
  return {
    id: r.id,
    account_id: r.accountId,
    phone_number_id: r.phoneNumberId,
    conversation_id: r.conversationId,
    persona_id: r.personaId,
    handled_by_user_id: r.handledByUserId,
    direction: r.direction as CallDirection,
    status: r.status as CallStatus,
    provider: r.provider,
    provider_call_sid: r.providerCallSid,
    from_number: r.fromNumber,
    to_number: r.toNumber,
    duration_seconds: r.durationSeconds ?? 0,
    total_cost_cents: r.totalCostCents ?? 0,
    recording_url: r.recordingUrl,
    transcript: Array.isArray(r.transcript) ? (r.transcript as VoiceCall["transcript"]) : [],
    metadata: r.metadata ?? {},
    started_at: r.startedAt,
    ended_at: r.endedAt,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
    recording_storage_path: r.recordingStoragePath,
    transcription_status: r.transcriptionStatus,
    transcription_error: r.transcriptionError,
    source_id: r.sourceId,
  };
}

// ── Phone numbers CRUD ──────────────────────────────────────────────
export async function fetchPhoneNumbers(accountId: string): Promise<PhoneNumber[]> {
  const rows = await apiClient.get<PhoneNumberApiRow[]>(`/accounts/${accountId}/phone-numbers`);
  return rows.map(mapPhoneNumber);
}

export async function createPhoneNumber(input: {
  accountId: string;
  e164: string;
  friendlyName?: string;
  inboxId?: string | null;
  pinnedPersonaId?: string | null;
  inboundBehavior?: InboundBehavior;
}): Promise<PhoneNumber> {
  const row = await apiClient.post<PhoneNumberApiRow>(
    `/accounts/${input.accountId}/phone-numbers`,
    {
      e164: input.e164,
      friendlyName: input.friendlyName,
      inboxId: input.inboxId ?? undefined,
      pinnedPersonaId: input.pinnedPersonaId ?? undefined,
      inboundBehavior: input.inboundBehavior,
    },
  );
  return mapPhoneNumber(row);
}

export async function updatePhoneNumber(
  accountId: string,
  id: string,
  updates: Partial<PhoneNumber>,
): Promise<PhoneNumber> {
  const row = await apiClient.patch<PhoneNumberApiRow>(
    `/accounts/${accountId}/phone-numbers/${id}`,
    {
      friendlyName: updates.friendly_name,
      inboxId: updates.inbox_id,
      pinnedPersonaId: updates.pinned_persona_id,
      inboundBehavior: updates.inbound_behavior,
      outboundEnabled: updates.outbound_enabled,
      enabled: updates.enabled,
    },
  );
  return mapPhoneNumber(row);
}

export async function deletePhoneNumber(accountId: string, id: string): Promise<void> {
  await apiClient.delete(`/accounts/${accountId}/phone-numbers/${id}`);
}

// ── Voice calls ─────────────────────────────────────────────────────
export async function fetchVoiceCalls(accountId: string, limit = 50): Promise<VoiceCall[]> {
  const rows = await apiClient.get<VoiceCallApiRow[]>(
    `/accounts/${accountId}/voice/calls?limit=${limit}`,
  );
  return rows.map(mapVoiceCall);
}

export async function fetchVoiceCall(accountId: string, id: string): Promise<VoiceCall | null> {
  try {
    const row = await apiClient.get<VoiceCallApiRow>(`/accounts/${accountId}/voice/calls/${id}`);
    return mapVoiceCall(row);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
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
 * Discagem outbound via Twilio direto. O caminho nativo ElevenLabs
 * (elevenlabs-outbound-call) ainda não foi portado — todo número hoje
 * disca via Twilio.
 */
export async function placeCall(input: {
  fromNumberId: string;
  toNumber: string;
  personaId?: string;
  contactId?: string;
  notes?: string;
  meetingId?: string;
  callPurpose?: "discovery" | "reminder" | "noshow_reschedule" | "followup";
  accountId: string;
}): Promise<PlaceCallResult> {
  try {
    const result = await apiClient.post<{
      ok: boolean;
      callId: string;
      via: "twilio";
      status?: string;
      reason?: string;
      message?: string;
      twilioCallSid?: string;
    }>(`/accounts/${input.accountId}/voice/calls`, {
      fromNumberId: input.fromNumberId,
      toNumber: input.toNumber,
      personaId: input.personaId,
      contactId: input.contactId,
      notes: input.notes,
      meetingId: input.meetingId,
      callPurpose: input.callPurpose,
    });
    return result;
  } catch (e) {
    return {
      ok: false,
      callId: "",
      via: "twilio",
      message: e instanceof Error ? e.message : "Falha ao discar",
    };
  }
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
export async function registerPhoneWithElevenLabs(accountId: string, phoneNumberId: string) {
  return apiClient.post<{
    ok: boolean;
    phone_number_id: string;
    elevenlabs_phone_number_id: string;
    elevenlabs_agent_id: string;
  }>(`/accounts/${accountId}/phone-numbers/${phoneNumberId}/activate-elevenlabs`);
}

// ── Voice clone ─────────────────────────────────────────────────────
export async function cloneVoiceForPersona(input: {
  accountId: string;
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

  return apiClient.post<{ voiceId: string; personaId: string; provider: string }>(
    `/accounts/${input.accountId}/voice-clone`,
    {
      personaId: input.personaId,
      audioBase64,
      filename: input.file.name,
      mimeType: input.file.type,
    },
  );
}

// ── Webhook URLs (for display in UI) ────────────────────────────────
export function getTwilioWebhookUrls(): { incoming: string; status: string } {
  const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
  return {
    incoming: `${apiUrl}/webhooks/twilio/incoming`,
    status: `${apiUrl}/webhooks/twilio/status`,
  };
}

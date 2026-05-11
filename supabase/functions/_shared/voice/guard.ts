// Voice guard — único ponto de validação pra discagem outbound.
//
// Centraliza:
//   1. Normalização E.164 (com default BR)
//   2. Checagens DNC + horário permitido + rate-limit (via RPC is_phone_allowed_to_call)
//   3. Logging em call_attempts_log
//
// Usado por voice-outbound (Twilio direto) e elevenlabs-outbound-call (EL).
// Bloqueia ANTES de criar voice_calls ou bater em API externa.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

export type GuardReason =
  | "invalid_e164"
  | "dnc"
  | "outside_allowed_hours"
  | "outside_allowed_day"
  | "too_soon"
  | "max_attempts_today"
  | "rpc_error";

export interface GuardOk {
  allowed: true;
  e164: string;
}

export interface GuardBlock {
  allowed: false;
  reason: GuardReason;
  message: string;
  details?: Record<string, unknown>;
}

export type GuardResult = GuardOk | GuardBlock;

// ───────────────────────────────────────────────────────────────
// E.164 normalização
// ───────────────────────────────────────────────────────────────

const E164_RE = /^\+[1-9]\d{6,14}$/;

/**
 * Normaliza um número pra E.164. Aceita formatos comuns BR:
 *   "+5511999998888"   → "+5511999998888"
 *   "5511999998888"    → "+5511999998888"
 *   "(11) 99999-8888"  → "+5511999998888"
 *   "11999998888"      → "+5511999998888"  (defaultRegion BR, 10/11 dígitos)
 *
 * Retorna `null` se não consegue normalizar de forma confiável.
 */
export function toE164(
  raw: string | null | undefined,
  defaultRegion: "BR" | "US" = "BR",
): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  // Já tem prefixo "+" → só strip não-dígitos do resto
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    const candidate = `+${digits}`;
    return E164_RE.test(candidate) ? candidate : null;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  // BR: 10 dígitos (fixo) ou 11 dígitos (celular). Adiciona +55.
  if (defaultRegion === "BR" && (digits.length === 10 || digits.length === 11)) {
    const candidate = `+55${digits}`;
    return E164_RE.test(candidate) ? candidate : null;
  }

  // US: 10 dígitos. Adiciona +1.
  if (defaultRegion === "US" && digits.length === 10) {
    const candidate = `+1${digits}`;
    return E164_RE.test(candidate) ? candidate : null;
  }

  // Senão, assume que veio com código país sem o "+" (ex: "5511…" ou "1212…")
  const candidate = `+${digits}`;
  return E164_RE.test(candidate) ? candidate : null;
}

// ───────────────────────────────────────────────────────────────
// Defaults & messages
// ───────────────────────────────────────────────────────────────

const DEFAULT_DIALING = {
  timezone: "America/Sao_Paulo",
  allowed_hours_local: {
    mon: [8, 21],
    tue: [8, 21],
    wed: [8, 21],
    thu: [8, 21],
    fri: [8, 21],
    sat: [9, 18],
    sun: null,
  } as Record<string, [number, number] | null>,
  max_attempts_per_day: 3,
  min_minutes_between_attempts: 60,
};

function messageForReason(
  reason: GuardReason,
  details: Record<string, unknown> = {},
): string {
  switch (reason) {
    case "invalid_e164":
      return "Número inválido. Use formato E.164 (+5511...).";
    case "dnc":
      return "Este número está na lista de bloqueio (DNC).";
    case "outside_allowed_hours": {
      const range = details.allowed_range as [number, number] | undefined;
      if (range) return `Fora do horário permitido (${range[0]}h–${range[1]}h).`;
      return "Fora do horário permitido para ligações.";
    }
    case "outside_allowed_day":
      return "Hoje não é dia permitido para ligações neste workspace.";
    case "too_soon": {
      const minGap = details.min_gap_minutes as number | undefined;
      if (minGap) return `Aguarde ${minGap} min antes de ligar de novo pra este número.`;
      return "Última tentativa foi muito recente. Aguarde antes de tentar de novo.";
    }
    case "max_attempts_today": {
      const cap = details.cap as number | undefined;
      if (cap) return `Limite diário (${cap} tentativas) atingido para este número.`;
      return "Limite diário de tentativas atingido para este número.";
    }
    case "rpc_error":
      return "Falha ao validar regras de discagem. Tente novamente.";
  }
}

// ───────────────────────────────────────────────────────────────
// Guard principal
// ───────────────────────────────────────────────────────────────

export interface GuardInput {
  accountId: string;
  toNumber: string;
  defaultRegion?: "BR" | "US";
  /** Campanhas em massa pulam too_soon/max_attempts_today (já têm próprio gate). */
  bypassRateLimit?: boolean;
}

export async function guardCall(
  admin: SupabaseClient,
  input: GuardInput,
): Promise<GuardResult> {
  // 1) E.164
  const e164 = toE164(input.toNumber, input.defaultRegion ?? "BR");
  if (!e164) {
    return {
      allowed: false,
      reason: "invalid_e164",
      message: messageForReason("invalid_e164"),
    };
  }

  // 2) Lê dialing_settings do account; mescla com defaults
  const { data: acc } = await admin
    .from("accounts")
    .select("dialing_settings")
    .eq("id", input.accountId)
    .maybeSingle();
  const settings = {
    ...DEFAULT_DIALING,
    ...((acc?.dialing_settings as Record<string, unknown>) ?? {}),
  };

  // 3) RPC is_phone_allowed_to_call (já existente — faz DNC + horário + rate-limit)
  //    Quando bypass, passa cap altíssimo + 0min interval pra pular essas duas.
  const { data: res, error } = await admin.rpc("is_phone_allowed_to_call", {
    p_account_id: input.accountId,
    p_phone_number: e164,
    p_timezone: (settings.timezone as string) ?? "America/Sao_Paulo",
    p_allowed_hours_local: settings.allowed_hours_local,
    p_max_attempts_per_day: input.bypassRateLimit
      ? 999_999
      : ((settings.max_attempts_per_day as number) ?? 3),
    p_min_minutes_between_attempts: input.bypassRateLimit
      ? 0
      : ((settings.min_minutes_between_attempts as number) ?? 60),
  });

  if (error) {
    return {
      allowed: false,
      reason: "rpc_error",
      message: messageForReason("rpc_error"),
      details: { error: error.message },
    };
  }

  const out = res as { allowed: boolean; reason?: string; [k: string]: unknown };
  if (!out?.allowed) {
    const reason = (out?.reason ?? "rpc_error") as GuardReason;
    return {
      allowed: false,
      reason,
      message: messageForReason(reason, out as Record<string, unknown>),
      details: out as Record<string, unknown>,
    };
  }

  return { allowed: true, e164 };
}

// ───────────────────────────────────────────────────────────────
// Logging
// ───────────────────────────────────────────────────────────────

export interface LogAttemptInput {
  accountId: string;
  phoneNumber: string;
  outcome: string;
  campaignId?: string | null;
  contactId?: string | null;
  voiceCallId?: string | null;
}

export async function logAttempt(
  admin: SupabaseClient,
  input: LogAttemptInput,
): Promise<void> {
  const { error } = await admin.from("call_attempts_log").insert({
    account_id: input.accountId,
    phone_number: input.phoneNumber,
    outcome: input.outcome,
    campaign_id: input.campaignId ?? null,
    contact_id: input.contactId ?? null,
    voice_call_id: input.voiceCallId ?? null,
  });
  if (error) {
    // não bloqueia fluxo principal — só loga
    console.error("[voice-guard] logAttempt failed:", error.message);
  }
}

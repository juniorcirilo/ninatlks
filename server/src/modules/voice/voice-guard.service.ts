import { Injectable, Scope } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantTxHost } from '../../common/tenant-tx.host';

export type GuardReason =
  | 'invalid_e164'
  | 'dnc'
  | 'outside_allowed_hours'
  | 'outside_allowed_day'
  | 'too_soon'
  | 'max_attempts_today'
  | 'rpc_error';

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

const E164_RE = /^\+[1-9]\d{6,14}$/;

/** Ported from supabase/functions/_shared/voice/guard.ts's toE164. */
export function toE164(
  raw: string | null | undefined,
  defaultRegion: 'BR' | 'US' = 'BR',
): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D/g, '');
    const candidate = `+${digits}`;
    return E164_RE.test(candidate) ? candidate : null;
  }

  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  if (
    defaultRegion === 'BR' &&
    (digits.length === 10 || digits.length === 11)
  ) {
    const candidate = `+55${digits}`;
    return E164_RE.test(candidate) ? candidate : null;
  }
  if (defaultRegion === 'US' && digits.length === 10) {
    const candidate = `+1${digits}`;
    return E164_RE.test(candidate) ? candidate : null;
  }

  const candidate = `+${digits}`;
  return E164_RE.test(candidate) ? candidate : null;
}

const DEFAULT_DIALING = {
  timezone: 'America/Sao_Paulo',
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
    case 'invalid_e164':
      return 'Número inválido. Use formato E.164 (+5511...).';
    case 'dnc':
      return 'Este número está na lista de bloqueio (DNC).';
    case 'outside_allowed_hours': {
      const range = details.allowed_range as [number, number] | undefined;
      if (range)
        return `Fora do horário permitido (${range[0]}h–${range[1]}h).`;
      return 'Fora do horário permitido para ligações.';
    }
    case 'outside_allowed_day':
      return 'Hoje não é dia permitido para ligações neste workspace.';
    case 'too_soon': {
      const minGap = details.min_gap_minutes as number | undefined;
      if (minGap)
        return `Aguarde ${minGap} min antes de ligar de novo pra este número.`;
      return 'Última tentativa foi muito recente. Aguarde antes de tentar de novo.';
    }
    case 'max_attempts_today': {
      const cap = details.cap as number | undefined;
      if (cap)
        return `Limite diário (${cap} tentativas) atingido para este número.`;
      return 'Limite diário de tentativas atingido para este número.';
    }
    case 'rpc_error':
      return 'Falha ao validar regras de discagem. Tente novamente.';
  }
}

export interface GuardInput {
  accountId: string;
  toNumber: string;
  defaultRegion?: 'BR' | 'US';
  /** Campanhas em massa pulam too_soon/max_attempts_today (já têm próprio gate). */
  bypassRateLimit?: boolean;
}

export interface LogAttemptInput {
  accountId: string;
  phoneNumber: string;
  outcome: string;
  campaignId?: string | null;
  contactId?: string | null;
  voiceCallId?: string | null;
}

/** Ported from supabase/functions/_shared/voice/guard.ts's guardCall/logAttempt. */
@Injectable({ scope: Scope.REQUEST })
export class VoiceGuardService {
  constructor(
    private readonly tx: TenantTxHost,
    private readonly dataSource: DataSource,
  ) {}

  async guardCall(input: GuardInput): Promise<GuardResult> {
    const e164 = toE164(input.toNumber, input.defaultRegion ?? 'BR');
    if (!e164) {
      return {
        allowed: false,
        reason: 'invalid_e164',
        message: messageForReason('invalid_e164'),
      };
    }

    const accRows = await this.tx.manager.query<
      { dialing_settings: Record<string, unknown> }[]
    >(`SELECT dialing_settings FROM accounts WHERE id = $1 LIMIT 1`, [
      input.accountId,
    ]);
    const settings = {
      ...DEFAULT_DIALING,
      ...(accRows[0]?.dialing_settings ?? {}),
    };

    let res: { allowed: boolean; reason?: string; [k: string]: unknown };
    try {
      const rows = await this.tx.manager.query<
        { is_phone_allowed_to_call: GuardRpcResult }[]
      >(
        `SELECT public.is_phone_allowed_to_call($1, $2, $3, $4::jsonb, $5, $6) AS is_phone_allowed_to_call`,
        [
          input.accountId,
          e164,
          settings.timezone ?? 'America/Sao_Paulo',
          JSON.stringify(settings.allowed_hours_local),
          input.bypassRateLimit
            ? 999_999
            : (settings.max_attempts_per_day ?? 3),
          input.bypassRateLimit
            ? 0
            : (settings.min_minutes_between_attempts ?? 60),
        ],
      );
      res = rows[0]?.is_phone_allowed_to_call ?? { allowed: false };
    } catch (err) {
      return {
        allowed: false,
        reason: 'rpc_error',
        message: messageForReason('rpc_error'),
        details: { error: err instanceof Error ? err.message : String(err) },
      };
    }

    if (!res.allowed) {
      const reason = (res.reason ?? 'rpc_error') as GuardReason;
      return {
        allowed: false,
        reason,
        message: messageForReason(reason, res),
        details: res,
      };
    }
    return { allowed: true, e164 };
  }

  // call_attempts_log has only an admin SELECT policy and no INSERT policy
  // at all for any role — goes through a SECURITY DEFINER wrapper (see
  // migrations/20260720230000-CallAttemptsLogInsertBypass.ts) since a plain
  // insert via the app's ordinary (non-BYPASSRLS) role is rejected outright.
  async logAttempt(input: LogAttemptInput): Promise<void> {
    await this.dataSource.query(
      `SELECT public.call_attempt_log_insert($1, $2, $3, $4, $5, $6)`,
      [
        input.accountId,
        input.phoneNumber,
        input.outcome,
        input.campaignId ?? null,
        input.contactId ?? null,
        input.voiceCallId ?? null,
      ],
    );
  }
}

interface GuardRpcResult {
  allowed: boolean;
  reason?: string;
  [k: string]: unknown;
}

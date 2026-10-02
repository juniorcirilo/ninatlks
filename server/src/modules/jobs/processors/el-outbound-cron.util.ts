import { DataSource } from 'typeorm';
import { buildSystemPromptWithGuardrails } from '../../voice/sdr-guardrails.util';

const PT_LANGUAGE = 'pt';
const PT_BR_LANGUAGE_INSTRUCTION =
  '\n\n# IDIOMA DA LIGAÇÃO\n- Fale exclusivamente em português do Brasil (PT-BR).\n- Use vocabulário, tratamento e pronúncia naturais do Brasil; nunca use português de Portugal.\n- A primeira fala deve ser em português brasileiro.\n- Nunca cumprimente nem responda em inglês.';

export interface OutboundPhone {
  id: string;
  e164: string;
  elevenlabs_phone_number_id: string | null;
  pinned_persona_id: string | null;
}
export interface PersonaRow {
  elevenlabs_agent_id: string | null;
  name: string | null;
  system_prompt: string | null;
  voice_clone_id: string | null;
}

/**
 * Shared by every cron job that dials via ElevenLabs on behalf of an
 * account with no HTTP request context (meeting-reminder-tick,
 * meeting-noshow-tick, cadence-tick) — DataSource direct, same exception
 * documented in media-cleanup.processor.ts (TenantTxHost/ElevenLabsConfigService
 * are request-scoped, unusable outside a request). All table access goes
 * through SECURITY DEFINER wrappers — see
 * migrations/20260720250000-OutboundDialCronBypass.ts.
 */
export async function resolveOutboundPhoneAndPersona(
  dataSource: DataSource,
  accountId: string,
): Promise<{ phone: OutboundPhone; personaId: string; persona: PersonaRow }> {
  const phoneRows = await dataSource.query<OutboundPhone[]>(
    `SELECT * FROM public.outbound_phone_resolve($1)`,
    [accountId],
  );
  const phone = phoneRows[0];
  if (!phone) throw new Error('no outbound phone configured for account');
  if (!phone.elevenlabs_phone_number_id) {
    throw new Error('phone not registered in ElevenLabs (run sync)');
  }

  let personaId = phone.pinned_persona_id;
  if (!personaId) {
    const personaRows = await dataSource.query<{ id: string }[]>(
      `SELECT * FROM public.agent_persona_resolve_id_for_account($1)`,
      [accountId],
    );
    personaId = personaRows[0]?.id ?? null;
  }
  if (!personaId) throw new Error('no enabled persona on account');

  const personaRows = await dataSource.query<PersonaRow[]>(
    `SELECT * FROM public.agent_persona_get_outbound_info($1)`,
    [personaId],
  );
  const persona = personaRows[0];
  if (!persona?.elevenlabs_agent_id)
    throw new Error('persona not synced with EL');

  return { phone, personaId, persona };
}

export async function resolveElevenLabsApiKey(
  dataSource: DataSource,
  accountId: string,
): Promise<string> {
  // Goes through the account_secret_resolve_bundle SECURITY DEFINER wrapper
  // (migrations/20260720190000-AccountSecretsResolveBypass.ts) — same
  // duplicate-gap fix as modules/voice/elevenlabs-creds.util.ts.
  const rows = await dataSource.query<{ decrypted_secret: string }[]>(
    `SELECT decrypted_secret FROM public.account_secret_resolve_bundle($1, 'elevenlabs') WHERE key_name = 'api_key'`,
    [accountId],
  );
  const key = rows[0]?.decrypted_secret || process.env.ELEVENLABS_API_KEY || '';
  if (!key)
    throw new Error('ElevenLabs API key não configurada para esta conta');
  return key;
}

/**
 * A ElevenLabs derruba a conversa (logo depois da saudação, quando o LLM
 * começa a responder) se o prompt referencia {{variavel}} sem valor. Completa
 * com '' as que não vieram — variáveis de sistema (system__*) são dela.
 */
export function fillMissingDynamicVariables(
  dynamicVariables: Record<string, string>,
  ...texts: Array<string | null | undefined>
): Record<string, string> {
  const filled = { ...dynamicVariables };
  for (const text of texts) {
    for (const m of (text ?? '').matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
      if (!(m[1] in filled)) filled[m[1]] = '';
    }
  }
  return filled;
}

export async function callElevenLabsOutbound(args: {
  elKey: string;
  agentId: string;
  elPhoneId: string;
  toNumber: string;
  firstMessage: string;
  systemPrompt: string;
  voiceCloneId?: string | null;
  dynamicVariables: Record<string, string>;
}): Promise<{
  ok: boolean;
  status: number;
  data: {
    callSid?: string;
    conversation_id?: string;
    success?: boolean;
    [k: string]: unknown;
  };
}> {
  const res = await fetch(
    'https://api.elevenlabs.io/v1/convai/twilio/outbound-call',
    {
      method: 'POST',
      headers: { 'xi-api-key': args.elKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: args.agentId,
        agent_phone_number_id: args.elPhoneId,
        to_number: args.toNumber,
        conversation_initiation_client_data: {
          conversation_config_override: {
            asr: { keywords: ['português', 'Brasil', 'Nina'] },
            agent: {
              language: PT_LANGUAGE,
              first_message: args.firstMessage,
              prompt: { prompt: args.systemPrompt },
            },
            tts: { voice_id: args.voiceCloneId ?? undefined },
          },
          dynamic_variables: fillMissingDynamicVariables(
            args.dynamicVariables,
            args.systemPrompt,
            args.firstMessage,
          ),
        },
      }),
    },
  );
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

export function buildFollowupSystemPrompt(
  systemPrompt: string | null | undefined,
  departamento: 'COMERCIAL' | 'FINANCEIRO' = 'COMERCIAL',
): string {
  return `${buildSystemPromptWithGuardrails(systemPrompt, departamento)}${PT_BR_LANGUAGE_INSTRUCTION}`;
}

export function formatMeetingTimeHuman(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));
}

/** Create the pre-dial voice_calls row, common to all three cron dial paths. */
export async function createOutboundVoiceCallRow(
  dataSource: DataSource,
  args: {
    accountId: string;
    phoneId: string;
    personaId: string;
    fromNumber: string;
    toNumber: string;
    metadata: Record<string, unknown>;
  },
): Promise<string> {
  const rows = await dataSource.query<{ id: string }[]>(
    `SELECT * FROM public.voice_call_create_outbound($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      args.accountId,
      args.phoneId,
      args.personaId,
      args.fromNumber,
      args.toNumber,
      JSON.stringify(args.metadata),
    ],
  );
  return rows[0].id;
}

/** Mark the voice_calls row failed/ringing based on the EL response, common to all three cron dial paths. */
export async function finalizeOutboundVoiceCall(
  dataSource: DataSource,
  callId: string,
  el: Awaited<ReturnType<typeof callElevenLabsOutbound>>,
): Promise<void> {
  if (!el.ok || el.data.success === false) {
    await dataSource.query(
      `SELECT public.voice_call_mark_outbound_failed($1, $2::jsonb)`,
      [callId, JSON.stringify({ error: el.data, el_status: el.status })],
    );
    throw new Error(`EL outbound failed: ${el.status}`);
  }
  await dataSource.query(
    `SELECT public.voice_call_mark_outbound_ringing($1, $2, $3)`,
    [callId, el.data.callSid ?? null, el.data.conversation_id ?? null],
  );
}

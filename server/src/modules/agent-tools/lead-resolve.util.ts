import { DataSource } from 'typeorm';

// Ported from supabase/functions/_shared/leads/resolve.ts.

export type OutcomeCategory =
  | 'scheduled'
  | 'qualified'
  | 'not_interested'
  | 'callback'
  | 'no_answer'
  | 'voicemail'
  | 'wrong_number'
  | 'escalated'
  | 'other';

export const FASE_TO_CATEGORY: Record<string, OutcomeCategory> = {
  novo_lead: 'other',
  qualificado: 'qualified',
  demo_agendada: 'scheduled',
  proposta: 'qualified',
  descartado: 'not_interested',
};

export const STAGE_BY_CATEGORY: Record<
  OutcomeCategory,
  { stageName: string; score: number }
> = {
  scheduled: { stageName: 'Reunião agendada', score: 95 },
  qualified: { stageName: 'Qualificado', score: 70 },
  callback: { stageName: 'Contatado', score: 50 },
  escalated: { stageName: 'Qualificado', score: 60 },
  no_answer: { stageName: 'Contatado', score: 20 },
  voicemail: { stageName: 'Contatado', score: 15 },
  not_interested: { stageName: 'Perdeu', score: 5 },
  wrong_number: { stageName: 'Perdeu', score: 0 },
  other: { stageName: 'Contatado', score: 30 },
};

export const TEMPERATURE_BOOST: Record<string, number> = {
  quente: 15,
  morno: 0,
  frio: -10,
};

export interface ResolveCallContext {
  account_id: string;
  conversation_id: string | null;
  from_number: string | null;
  to_number: string | null;
  direction: string | null;
  metadata: Record<string, unknown> | null;
}

function nameFromCallMetadata(
  metadata: Record<string, unknown> | null,
): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const dynamicVariables = metadata.dynamic_variables as
    Record<string, unknown> | undefined;
  const candidates = [
    metadata.lead_name,
    metadata.contact_name,
    metadata.invitee_name,
    dynamicVariables?.lead_name,
  ];
  for (const c of candidates) {
    if (typeof c === 'string') {
      const trimmed = c.trim();
      if (
        trimmed.length >= 2 &&
        trimmed.length <= 80 &&
        !/^(olá|oi|alô)$/i.test(trimmed)
      ) {
        return trimmed;
      }
    }
  }
  return null;
}

/**
 * Resolve contact_id da call. Tenta na ordem:
 *   1. metadata.contact_id (set por dispatchers)
 *   2. via conversation_id → conversations.contact_id
 *   3. lookup por phone_number (from se inbound, to se outbound)
 *   4. cria contact novo com source apropriada
 */
export async function resolveContactIdFromCall(
  dataSource: DataSource,
  call: ResolveCallContext,
): Promise<string | null> {
  const metaContactId = call.metadata?.contact_id;
  if (typeof metaContactId === 'string' && metaContactId) return metaContactId;

  if (call.conversation_id) {
    const rows = await dataSource.query<{ contact_id: string | null }[]>(
      `SELECT contact_id FROM conversations WHERE id = $1 LIMIT 1`,
      [call.conversation_id],
    );
    if (rows[0]?.contact_id) return rows[0].contact_id;
  }

  const leadPhone =
    call.direction === 'outbound' ? call.to_number : call.from_number;
  if (leadPhone) {
    const existingRows = await dataSource.query<{ id: string }[]>(
      `SELECT id FROM contacts WHERE account_id = $1 AND phone_number = $2 LIMIT 1`,
      [call.account_id, leadPhone],
    );
    if (existingRows[0]?.id) return existingRows[0].id;

    const seedName = nameFromCallMetadata(call.metadata);
    const identifier = `sms:${leadPhone}`;
    const createdRows = await dataSource.query<{ id: string }[]>(
      `INSERT INTO contacts (account_id, phone_number, identifier, source, name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now(), now())
       ON CONFLICT (account_id, identifier) WHERE identifier IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        call.account_id,
        leadPhone,
        identifier,
        call.direction === 'outbound' ? 'outbound' : 'inbound',
        seedName ?? leadPhone,
      ],
    );
    if (createdRows[0]?.id) return createdRows[0].id;

    // Conflict (race) — the row exists now, re-select.
    const raceRows = await dataSource.query<{ id: string }[]>(
      `SELECT id FROM contacts WHERE account_id = $1 AND identifier = $2 LIMIT 1`,
      [call.account_id, identifier],
    );
    return raceRows[0]?.id ?? null;
  }
  return null;
}

/**
 * Resolve stage_id pelo nome da stage no pipeline default da account.
 * Retorna null se não houver pipeline default ou stage com esse nome.
 */
export async function resolveStageIdByName(
  dataSource: DataSource,
  accountId: string,
  stageName: string,
): Promise<string | null> {
  const rows = await dataSource.query<{ id: string }[]>(
    `SELECT s.id FROM lead_stages s
     JOIN lead_pipelines p ON p.id = s.pipeline_id
     WHERE p.account_id = $1 AND p.is_default = true AND s.name = $2
     LIMIT 1`,
    [accountId, stageName],
  );
  return rows[0]?.id ?? null;
}

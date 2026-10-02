/** DataSource e EntityManager (tx do request) — ambos têm `query`. */
type Queryable = { query: <T = any>(sql: string, params?: any[]) => Promise<T> };

export type Departamento = 'COMERCIAL' | 'FINANCEIRO';

/** "João  da Sílva" → "joao da silva": chave de de-para ERP ↔ sales_reps. */
export function normalizeVendedorKey(raw: string | null | undefined): string {
  return (raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** "+55[41]3512-0638" / "(41) 3512-0638" → "+554135120638". Sem DDI assume Brasil (+55). */
export function normalizeE164(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const full =
    digits.startsWith('55') && digits.length >= 12 ? digits : `55${digits}`;
  const e164 = `+${full}`;
  return /^\+[1-9][0-9]{9,14}$/.test(e164) ? e164 : null;
}

/**
 * persona.config.kind é o sinal canônico, mas personas antigas (ex.: "Diego Cobrança")
 * têm config={}; o fallback por nome é o mesmo usado na sync da ElevenLabs.
 */
export function isCobrancaPersona(persona: {
  name?: string | null;
  config?: Record<string, unknown> | null;
}): boolean {
  return (
    persona.config?.kind === 'cobranca' ||
    /cobran|inadimpl|d[ií]vida|cart[eé]ira/i.test(persona.name ?? '')
  );
}

/** Cobrança → FINANCEIRO (nunca vendedor). Persona de cobrança ou campanha de cobrança. */
export function transferDepartamento(args: {
  persona?: { name?: string | null; config?: Record<string, unknown> | null };
  campaignKind?: string | null;
}): Departamento {
  if (args.campaignKind === 'cobranca') return 'FINANCEIRO';
  if (args.persona && isCobrancaPersona(args.persona)) return 'FINANCEIRO';
  return 'COMERCIAL';
}

export type PendenciaReason =
  | 'sem_vendedor'
  | 'sem_cadastro'
  | 'sem_telefone'
  | 'sem_atendente_padrao';

export interface TransferDestination {
  departamento: Departamento;
  /** Telefone E.164 de destino; null = sem destino (ligação segue sem transferência). */
  phone: string | null;
  /** Como a IA cita o destino ("Soraya", "nossa central de atendimento comercial"). */
  atendenteNome: string | null;
  /** Nome do vendedor do lead quando casou com o cadastro (compat {{vendedor_nome}}). */
  vendedorNome: string | null;
  source: 'vendedor' | 'padrao' | 'none';
  pendencia: { reason: PendenciaReason; key: string } | null;
}

interface RepRow {
  id: string;
  nome: string;
  nome_falado: string | null;
  phone_e164: string | null;
  is_default: boolean;
}

/** Atendente padrão ativo do departamento (com telefone), ou null. */
export async function getDefaultAtendente(
  dataSource: Queryable,
  accountId: string,
  departamento: Departamento,
): Promise<{ nome: string; nomeFalado: string; phone: string } | null> {
  const rows = await dataSource.query<RepRow[]>(
    `SELECT id, nome, nome_falado, phone_e164, is_default FROM public.sales_reps
      WHERE account_id = $1 AND departamento = $2 AND is_default AND active
        AND phone_e164 IS NOT NULL
      LIMIT 1`,
    [accountId, departamento],
  );
  const r = rows[0];
  if (!r?.phone_e164) return null;
  return { nome: r.nome, nomeFalado: r.nome_falado?.trim() || r.nome, phone: r.phone_e164 };
}

/**
 * Destino de transferência da ligação, SEGREGADO por departamento.
 *  - COMERCIAL: vendedor do lead (rep COMERCIAL com telefone) → atendente padrão COMERCIAL → none
 *    (o chamador ainda pode cair no número da campanha, comportamento legado).
 *  - FINANCEIRO: SEMPRE o atendente padrão FINANCEIRO. O vendedor do lead é ignorado de
 *    propósito: cobrança nunca transborda para a equipe de vendas.
 * Singleton-safe (DataSource direto): usado pelo disparador, fora de request/tenant.
 */
export async function resolveTransferDestination(
  dataSource: Queryable,
  args: {
    accountId: string;
    departamento: Departamento;
    vendedorNome?: string | null;
  },
): Promise<TransferDestination> {
  const { accountId, departamento } = args;
  const base = {
    departamento,
    vendedorNome: null as string | null,
  };

  if (departamento === 'FINANCEIRO') {
    const def = await getDefaultAtendente(dataSource, accountId, 'FINANCEIRO');
    if (def) {
      return { ...base, phone: def.phone, atendenteNome: def.nomeFalado, source: 'padrao', pendencia: null };
    }
    return {
      ...base,
      phone: null,
      atendenteNome: null,
      source: 'none',
      pendencia: { reason: 'sem_atendente_padrao', key: 'financeiro' },
    };
  }

  const key = normalizeVendedorKey(args.vendedorNome);
  let pendencia: TransferDestination['pendencia'] = null;
  if (!key) {
    pendencia = { reason: 'sem_vendedor', key: '(sem vendedor)' };
  } else {
    const rows = await dataSource.query<RepRow[]>(
      `SELECT id, nome, nome_falado, phone_e164, is_default FROM public.sales_reps
        WHERE account_id = $1 AND departamento = 'COMERCIAL' AND active AND $2 = ANY(match_keys)
        ORDER BY (phone_e164 IS NOT NULL) DESC, created_at ASC
        LIMIT 1`,
      [accountId, key],
    );
    const rep = rows[0];
    if (rep?.phone_e164) {
      return {
        ...base,
        vendedorNome: rep.nome,
        phone: rep.phone_e164,
        atendenteNome: rep.nome_falado?.trim() || rep.nome,
        source: 'vendedor',
        pendencia: null,
      };
    }
    pendencia = { reason: rep ? 'sem_telefone' : 'sem_cadastro', key };
  }

  const def = await getDefaultAtendente(dataSource, accountId, 'COMERCIAL');
  if (def) {
    return { ...base, phone: def.phone, atendenteNome: def.nomeFalado, source: 'padrao', pendencia };
  }
  return { ...base, phone: null, atendenteNome: null, source: 'none', pendencia };
}

/** Upsert da pendência aberta (uma por conta+departamento+vendedor+motivo; conta ocorrências). */
export async function recordSalesRepPendencia(
  dataSource: Queryable,
  args: {
    accountId: string;
    departamento: Departamento;
    key: string;
    vendedorNome: string | null;
    reason: PendenciaReason;
    campaignId: string | null;
    fallbackNumber: string | null;
  },
): Promise<void> {
  await dataSource.query(
    `INSERT INTO public.sales_rep_pendencias
       (account_id, departamento, vendedor_key, vendedor_nome, reason, campaign_id, fallback_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (account_id, departamento, vendedor_key, reason) WHERE resolved_at IS NULL
     DO UPDATE SET occurrences = public.sales_rep_pendencias.occurrences + 1,
                   last_seen_at = now(),
                   campaign_id = EXCLUDED.campaign_id,
                   fallback_number = EXCLUDED.fallback_number`,
    [
      args.accountId,
      args.departamento,
      args.key,
      args.vendedorNome,
      args.reason,
      args.campaignId,
      args.fallbackNumber,
    ],
  );
}

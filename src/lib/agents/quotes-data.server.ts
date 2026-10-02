// Leitura direta de orçamentos (ERP + chat) — Node/pg puro, sem createServerFn.
// Sufixo *.server.ts é o que garante exclusão do bundle client (ver
// bruno-pdf.server.ts): função solta (não envolta em createServerFn) chamada
// por mais de um arquivo de server fn vira código "vivo" e alcançável a
// partir do client se ficar num módulo comum sem esse sufixo — foi assim que
// uma referência a `Buffer` (Node) vazou pro bundle do browser e quebrou a
// tela com "Buffer is not defined".

import { query, queryAsAccount } from "@/lib/db";

export interface QuoteItem {
  sku: string;
  name: string;
  qty: number;
  unit_price: number;
  subtotal: number;
  kind: string;
}

export interface QuoteRow {
  id: string;
  personaName: string;
  customerName: string | null;
  projectDescription: string | null;
  usageType: string | null;
  items: QuoteItem[];
  subtotal: number;
  marginPct: number;
  total: number;
  status: string;
  validityDays: number;
  createdAt: string;
}

export interface ErpQuoteRow {
  /** Id da linha em `orcamentos_erp` — um cliente pode ter vários orçamentos. */
  id: string;
  contactId: string;
  customerName: string | null;
  phoneNumber: string | null;
  email: string | null;
  externalId: string | null;
  numeroOrcamento: string | null;
  valorTotal: number | null;
  dataEmissao: string | null;
  dataPrevisao: string | null;
  vendedorNome: string | null;
  statusOrcamento: string | null;
  pedidoCliente: string | null;
  companyId: string | null;
  razaoSocial: string | null;
  nomeFantasia: string | null;
}

/** Orçamentos com persona_id apontando pra persona de orçamento (document_kind
 * = 'orcamento', hoje a Sofia) desta conta — join estável por document_kind
 * em vez do nome livre da persona, que qualquer admin pode renomear em
 * Configurações > Agentes (ver 20260904010000-CobrancaOrcamentoTables). */
export async function fetchChatQuotes(accountId: string): Promise<QuoteRow[]> {
  const rows = await query<{
    id: string;
    persona_name: string;
    customer_name: string | null;
    project_description: string | null;
    usage_type: string | null;
    items: QuoteItem[];
    subtotal: string;
    margin_pct: string;
    total: string;
    status: string;
    validity_days: number;
    created_at: string;
  }>(
    `SELECT q.id, p.name AS persona_name, q.customer_name, q.project_description,
            q.usage_type, q.items, q.subtotal, q.margin_pct, q.total, q.status,
            q.validity_days, q.created_at
       FROM public.quotes q
       JOIN public.agent_personas p ON p.id = q.persona_id
      WHERE q.account_id = $1 AND p.document_kind = 'orcamento'
      ORDER BY q.created_at DESC`,
    [accountId],
  );

  return rows.map((r) => ({
    id: r.id,
    personaName: r.persona_name,
    customerName: r.customer_name,
    projectDescription: r.project_description,
    usageType: r.usage_type,
    items: r.items ?? [],
    subtotal: Number(r.subtotal),
    marginPct: Number(r.margin_pct),
    total: Number(r.total),
    status: r.status,
    validityDays: r.validity_days,
    createdAt: r.created_at,
  }));
}

/**
 * Orçamentos recebidos pelo webhook de integração (n8n → ERP) da Sofia —
 * uma linha por orçamento (`public.orcamentos_erp`, ver migration
 * CobrancaOrcamentoTables20260904010000). Antes disso vivia dentro de
 * `contacts.custom_attributes.ingest_variables`, um blob por contato que só
 * guardava o último orçamento recebido; a tabela dedicada permite vários
 * orçamentos por cliente sem perder nenhum.
 */
export async function fetchErpQuotes(userId: string, accountId: string): Promise<ErpQuoteRow[]> {
  const rows = await queryAsAccount<{
    id: string;
    contact_id: string;
    name: string | null;
    phone_number: string | null;
    email: string | null;
    external_id: string | null;
    numero_orcamento: string | null;
    pedido_cliente: string | null;
    valor_total: string | null;
    data_emissao: string | null;
    data_previsao: string | null;
    status_orcamento: string | null;
    company_id: string | null;
    razao_social: string | null;
    nome_fantasia: string | null;
    vendedor_nome_erp: string | null;
    vendedor_resolved_nome: string | null;
  }>(
    userId,
    accountId,
    `SELECT o.id, o.contact_id, c.name, c.phone_number, c.email, c.external_id,
            o.numero_orcamento, o.pedido_cliente, o.valor_total, o.data_emissao,
            o.data_previsao, o.status_orcamento,
            co.id AS company_id, co.razao_social, co.nome_fantasia, co.vendedor_nome_erp,
            coalesce(p.display_name, p.name, p.email) AS vendedor_resolved_nome
       FROM public.orcamentos_erp o
       JOIN public.contacts c ON c.id = o.contact_id
       LEFT JOIN public.companies co ON co.id = c.company_id
       LEFT JOIN public.account_users au ON au.user_id = co.vendedor_id AND au.account_id = o.account_id
       LEFT JOIN public.profiles p ON p.id = au.user_id
      WHERE o.account_id = $1
        AND c.deleted_at IS NULL
      ORDER BY o.created_at DESC`,
    [accountId],
  );

  return rows.map((r) => ({
    id: r.id,
    contactId: r.contact_id,
    customerName: r.name,
    phoneNumber: r.phone_number,
    email: r.email,
    externalId: r.external_id,
    numeroOrcamento: r.numero_orcamento,
    valorTotal: r.valor_total != null ? Number(r.valor_total) : null,
    dataEmissao: r.data_emissao,
    dataPrevisao: r.data_previsao,
    vendedorNome: r.vendedor_resolved_nome ?? r.vendedor_nome_erp,
    statusOrcamento: r.status_orcamento,
    pedidoCliente: r.pedido_cliente,
    companyId: r.company_id,
    // Ver mesmo fallback em cobranca-data.server.ts: `companies.razao_social`
    // só vem preenchida via webhook de push; a busca ativa ainda manda a
    // razão social dentro de `c.name` (field_map "name" -> "razao_social",
    // não existe outro campo de nome pra cliente B2B).
    razaoSocial: r.razao_social ?? r.name,
    nomeFantasia: r.nome_fantasia,
  }));
}

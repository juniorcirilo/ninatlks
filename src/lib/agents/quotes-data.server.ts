// Leitura direta de orçamentos (ERP + chat) — Node/pg puro, sem createServerFn.
// Sufixo *.server.ts é o que garante exclusão do bundle client (ver
// bruno-pdf.server.ts): função solta (não envolta em createServerFn) chamada
// por mais de um arquivo de server fn vira código "vivo" e alcançável a
// partir do client se ficar num módulo comum sem esse sufixo — foi assim que
// uma referência a `Buffer` (Node) vazou pro bundle do browser e quebrou a
// tela com "Buffer is not defined".

import { query } from "@/lib/db";

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
}

/** Orçamentos com persona_id apontando para a persona "Bruno" desta conta —
 * é o que define "controlado pelo agente Bruno" nesta tela. */
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
      WHERE q.account_id = $1 AND p.name = 'Bruno'
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
 * Orçamentos recebidos pelo webhook de integração (n8n → ERP) do Bruno —
 * ver Configurações > Webhooks > Recebimento > Templates por agente. Cada
 * linha é um contato da lista operacional `agent:<persona Bruno>`, com os
 * campos do ERP (numero_orcamento, valor_total, status_orcamento, ...)
 * gravados em `contacts.custom_attributes.ingest_variables` — não existe
 * tabela própria para isso, a integração escreve direto no contato (ver
 * `ingest_agent_contact`, AgentInboundUpsert20260730190000).
 */
export async function fetchErpQuotes(accountId: string): Promise<ErpQuoteRow[]> {
  const rows = await query<{
    id: string;
    name: string | null;
    phone_number: string | null;
    email: string | null;
    external_id: string | null;
    vars: Record<string, unknown> | null;
    created_at: string;
  }>(
    `SELECT c.id, c.name, c.phone_number, c.email, c.external_id,
            c.custom_attributes -> 'ingest_variables' AS vars, c.created_at
       FROM public.contacts c
       JOIN public.contact_list_members m ON m.contact_id = c.id
       JOIN public.contact_lists l ON l.id = m.list_id
       JOIN public.agent_personas p ON p.account_id = l.account_id AND p.name = 'Bruno'
      WHERE l.account_id = $1
        AND l.external_key = 'agent:' || p.id::text
        AND c.deleted_at IS NULL
      ORDER BY c.created_at DESC`,
    [accountId],
  );

  return rows.map((r) => {
    const v = r.vars ?? {};
    return {
      contactId: r.id,
      customerName: r.name,
      phoneNumber: r.phone_number,
      email: r.email,
      externalId: r.external_id,
      numeroOrcamento: v.numero_orcamento != null ? String(v.numero_orcamento) : null,
      valorTotal: v.valor_total != null ? Number(v.valor_total) : null,
      dataEmissao: typeof v.data_emissao === "string" ? v.data_emissao : null,
      dataPrevisao: typeof v.data_previsao === "string" ? v.data_previsao : null,
      vendedorNome: typeof v.vendedor_nome === "string" ? v.vendedor_nome : null,
      statusOrcamento: typeof v.status_orcamento === "string" ? v.status_orcamento : null,
      pedidoCliente: typeof v.pedido_cliente === "string" ? v.pedido_cliente : null,
    };
  });
}

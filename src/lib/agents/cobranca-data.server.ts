// Leitura direta de cobranças (títulos em aberto) — Node/pg puro, sem
// createServerFn. Sufixo *.server.ts é o que garante exclusão do bundle
// client (mesmo motivo de quotes-data.server.ts).

import { queryAsAccount } from "@/lib/db";

export interface CobrancaRow {
  /** Id da linha em `cobranca_titulos` — um cliente pode ter várias, uma por título. */
  id: string;
  contactId: string;
  customerName: string | null;
  phoneNumber: string | null;
  email: string | null;
  externalId: string | null;
  numeroTitulo: string | null;
  parcela: string | null;
  dataEmissao: string | null;
  dataVencimento: string | null;
  diasEmAtraso: number | null;
  valorOriginalParcela: number | null;
  valorJaPago: number | null;
  valorDevedorSaldo: number | null;
  statusTitulo: string | null;
  numeroPedido: string | null;
  vendedorNome: string | null;
  companyId: string | null;
  razaoSocial: string | null;
  nomeFantasia: string | null;
}

/**
 * Títulos em aberto recebidos pelo webhook de integração (n8n → ERP) do
 * Diego Cobrança — uma linha por título (`public.cobranca_titulos`, ver
 * migration CobrancaOrcamentoTables20260904010000). Antes disso vivia dentro
 * de `contacts.custom_attributes.ingest_variables`, um blob por contato que
 * só guardava o último título recebido; a tabela dedicada permite vários
 * títulos por cliente sem perder nenhum.
 *
 * `companies` é a fonte centralizada de razão social/nome fantasia/vendedor
 * (mesma tabela que Orçamentos e Central de Contatos usam).
 */
export async function fetchCobrancaTitulos(userId: string, accountId: string): Promise<CobrancaRow[]> {
  const rows = await queryAsAccount<{
    id: string;
    contact_id: string;
    name: string | null;
    phone_number: string | null;
    email: string | null;
    external_id: string | null;
    numero_titulo: string | null;
    parcela: string | null;
    data_emissao: string | null;
    data_vencimento: string | null;
    dias_em_atraso: number | null;
    valor_original_parcela: string | null;
    valor_ja_pago: string | null;
    valor_devedor_saldo: string | null;
    status_titulo: string | null;
    numero_pedido: string | null;
    company_id: string | null;
    razao_social: string | null;
    nome_fantasia: string | null;
    vendedor_nome_erp: string | null;
    vendedor_resolved_nome: string | null;
  }>(
    userId,
    accountId,
    `SELECT t.id, t.contact_id, c.name, c.phone_number, c.email, c.external_id,
            t.numero_titulo, t.parcela, t.data_emissao, t.data_vencimento,
            t.dias_em_atraso, t.valor_original_parcela, t.valor_ja_pago,
            t.valor_devedor_saldo, t.status_titulo, t.numero_pedido,
            co.id AS company_id, co.razao_social, co.nome_fantasia, co.vendedor_nome_erp,
            coalesce(p.display_name, p.name, p.email) AS vendedor_resolved_nome
       FROM public.cobranca_titulos t
       JOIN public.contacts c ON c.id = t.contact_id
       LEFT JOIN public.companies co ON co.id = c.company_id
       LEFT JOIN public.account_users au ON au.user_id = co.vendedor_id AND au.account_id = t.account_id
       LEFT JOIN public.profiles p ON p.id = au.user_id
      WHERE t.account_id = $1
        AND c.deleted_at IS NULL
      ORDER BY t.dias_em_atraso DESC NULLS LAST, t.created_at DESC`,
    [accountId],
  );

  return rows.map((r) => ({
    id: r.id,
    contactId: r.contact_id,
    customerName: r.name,
    phoneNumber: r.phone_number,
    email: r.email,
    externalId: r.external_id,
    numeroTitulo: r.numero_titulo,
    parcela: r.parcela,
    dataEmissao: r.data_emissao,
    dataVencimento: r.data_vencimento,
    diasEmAtraso: r.dias_em_atraso,
    valorOriginalParcela: r.valor_original_parcela != null ? Number(r.valor_original_parcela) : null,
    valorJaPago: r.valor_ja_pago != null ? Number(r.valor_ja_pago) : null,
    valorDevedorSaldo: r.valor_devedor_saldo != null ? Number(r.valor_devedor_saldo) : null,
    statusTitulo: r.status_titulo,
    numeroPedido: r.numero_pedido,
    vendedorNome: r.vendedor_resolved_nome ?? r.vendedor_nome_erp,
    companyId: r.company_id,
    // `companies.razao_social` só vem preenchida via webhook de push (o
    // caminho de busca ativa — Configurações > Webhooks > Fontes de Dados —
    // ainda não manda razaoSocial/nomeFantasia como campo de primeira
    // classe, só telefone/nome/email/código). Até isso ser corrigido na
    // ingestão, `c.name` já traz a razão social na prática: o field_map da
    // fonte mapeia "name" -> "razao_social" porque não existe outro campo de
    // nome pra clientes B2B — sem este fallback a coluna ficaria vazia pra
    // quem sincroniza por essa fonte.
    razaoSocial: r.razao_social ?? r.name,
    nomeFantasia: r.nome_fantasia,
  }));
}

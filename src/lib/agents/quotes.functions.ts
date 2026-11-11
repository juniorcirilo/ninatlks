// Orçamentos gerados pela Sofia (Funcionário IA orçamentista de vidros).
// Lista e download de PDF para a tela /orcamentos.

import { createServerFn } from "@tanstack/react-start";
import { requireSessionAuth } from "@/lib/session-middleware";
import { z } from "zod";
import { query, getOne, queryAsAccount } from "@/lib/db";
import { fetchChatQuotes, fetchErpQuotes, type QuoteItem, type QuoteRow, type ErpQuoteRow } from "./quotes-data.server";

export type { QuoteItem, QuoteRow, ErpQuoteRow };

// accountId nunca vem de `data` (client-supplied) — sempre de
// `context.accountId`, resolvido pela sessão em requireSessionAuth. Usar o
// accountId do body permitiria a qualquer usuário autenticado ler/editar/
// apagar orçamentos de outra conta só trocando o valor enviado (IDOR entre
// tenants) — accountId ainda é aceito no schema só por compatibilidade com
// chamadores existentes, mas é ignorado.

export const listSofiaQuotes = createServerFn({ method: "GET" })
  .middleware([requireSessionAuth])
  .inputValidator((d) => z.object({ accountId: z.string().uuid().optional() }).parse(d))
  .handler(async ({ context }) => {
    const accountId = requireAccountId(context);
    const quotes = await fetchChatQuotes(accountId);
    return {
      quotes,
      totalValue: quotes.reduce((acc, q) => acc + q.total, 0),
    };
  });

/**
 * Orçamentos recebidos pelo webhook de integração (n8n → ERP) da Sofia —
 * ver Configurações > Webhooks > Recebimento > Templates por agente. Uma
 * linha por orçamento em `public.orcamentos_erp` (ver `ingest_agent_contact`,
 * migration CobrancaOrcamentoTables20260904010000).
 */
export const listSofiaErpQuotes = createServerFn({ method: "GET" })
  .middleware([requireSessionAuth])
  .inputValidator((d) => z.object({ accountId: z.string().uuid().optional() }).parse(d))
  .handler(async ({ context }) => {
    const accountId = requireAccountId(context);
    const quotes = await fetchErpQuotes(context.userId, accountId);
    return {
      quotes,
      totalValue: quotes.reduce((acc, q) => acc + (q.valorTotal ?? 0), 0),
    };
  });

const QUOTE_STATUSES = ["gerado", "aprovado", "recusado", "expirado"] as const;

/** Edita os campos de negócio de um orçamento gerado em chat. Itens/valores
 * calculados (subtotal, margem, total) não são editáveis aqui — vêm do
 * cálculo original; mudar isso exigiria refazer o PDF. */
export const updateQuote = createServerFn({ method: "POST" })
  .middleware([requireSessionAuth])
  .inputValidator((d) =>
    z.object({
      accountId: z.string().uuid().optional(),
      quoteId: z.string().uuid(),
      customerName: z.string().max(200).nullable(),
      projectDescription: z.string().max(500).nullable(),
      status: z.enum(QUOTE_STATUSES),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const accountId = requireAccountId(context);
    const rows = await query(
      `UPDATE public.quotes
          SET customer_name = $3, project_description = $4, status = $5, updated_at = now()
        WHERE id = $1 AND account_id = $2
        RETURNING id`,
      [data.quoteId, accountId, data.customerName, data.projectDescription, data.status],
    );
    if (rows.length === 0) throw new Error("Orçamento não encontrado");
    return { ok: true };
  });

export const deleteQuote = createServerFn({ method: "POST" })
  .middleware([requireSessionAuth])
  .inputValidator((d) =>
    z.object({ accountId: z.string().uuid().optional(), quoteId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const accountId = requireAccountId(context);
    const rows = await query(
      `DELETE FROM public.quotes WHERE id = $1 AND account_id = $2 RETURNING id`,
      [data.quoteId, accountId],
    );
    if (rows.length === 0) throw new Error("Orçamento não encontrado");
    return { ok: true };
  });

/** Edita o contato de um orçamento recebido do ERP — só telefone e email.
 * Os demais campos (nº, valor, datas, vendedor, status) vêm da integração e
 * não são editáveis aqui de propósito: são dado de origem do ERP, e deixar
 * corrigir à mão criaria divergência silenciosa com o sistema de origem.
 * Telefone/email são dado de contato — cabe ao time corrigir se o ERP
 * mandou errado. Razão social, nome fantasia e vendedor agora aparecem
 * nesta tela (via `companies`), mas só como leitura — quem edita esses
 * dados de empresa é a Central de Contatos. */
export const updateErpQuote = createServerFn({ method: "POST" })
  .middleware([requireSessionAuth])
  .inputValidator((d) =>
    z.object({
      accountId: z.string().uuid().optional(),
      contactId: z.string().uuid(),
      phoneNumber: z.string().max(40).nullable(),
      email: z.string().max(200).nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const accountId = requireAccountId(context);
    let rows;
    try {
      rows = await query(
        `UPDATE public.contacts c
            SET phone_number = $3, email = $4, updated_at = now()
          WHERE c.id = $1 AND c.account_id = $2
          RETURNING c.id`,
        [data.contactId, accountId, data.phoneNumber, data.email],
      );
    } catch (err) {
      // contacts_account_id_email_key — outro contato desta conta já usa esse e-mail.
      if (err instanceof Error && /contacts_account_id_email_key/.test(err.message)) {
        throw new Error("Este e-mail já pertence a outro contato desta conta.");
      }
      throw err;
    }
    if (rows.length === 0) throw new Error("Orçamento não encontrado");
    return { ok: true };
  });

/** Exclui um orçamento — remove só aquela linha de `orcamentos_erp`. O
 * contato continua na lista operacional da Sofia (e nos outros orçamentos
 * que ele tenha) independente de quantos existiam antes. */
export const deleteErpQuote = createServerFn({ method: "POST" })
  .middleware([requireSessionAuth])
  .inputValidator((d) =>
    z.object({ accountId: z.string().uuid().optional(), orcamentoId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const accountId = requireAccountId(context);
    // orcamentos_erp tem FORCE ROW LEVEL SECURITY — precisa do contexto de
    // sessão (queryAsAccount), senão a policy nega e a linha nunca é
    // encontrada mesmo pertencendo à conta certa.
    const rows = await queryAsAccount(
      context.userId,
      accountId,
      `DELETE FROM public.orcamentos_erp WHERE id = $1 AND account_id = $2 RETURNING id`,
      [data.orcamentoId, accountId],
    );
    if (rows.length === 0) throw new Error("Orçamento não encontrado");
    return { ok: true };
  });

/** Bytes do PDF salvo para um orçamento, para download na tela. */
export const downloadQuotePdf = createServerFn({ method: "GET" })
  .middleware([requireSessionAuth])
  .inputValidator((d) =>
    z.object({ accountId: z.string().uuid().optional(), quoteId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const accountId = requireAccountId(context);
    const row = await getOne<{ pdf_bytes: Buffer | null; customer_name: string | null }>(
      `SELECT pdf_bytes, customer_name FROM public.quotes WHERE id = $1 AND account_id = $2`,
      [data.quoteId, accountId],
    );
    if (!row || !row.pdf_bytes) throw new Error("Orçamento não encontrado");
    return {
      base64: Buffer.from(row.pdf_bytes).toString("base64"),
      filename: `orcamento-${(row.customer_name ?? data.quoteId).replace(/[^\w-]+/g, "_")}.pdf`,
    };
  });

/** Apaga TODOS os orçamentos desta conta — os do ERP (`orcamentos_erp`) e os
 * gerados em chat (`quotes`, com PDF). Reset da tela; clientes/contatos não
 * são afetados. */
export const truncateQuotes = createServerFn({ method: "POST" })
  .middleware([requireSessionAuth])
  .inputValidator((d) => z.object({ accountId: z.string().uuid().optional() }).parse(d))
  .handler(async ({ context }) => {
    const accountId = requireAccountId(context);
    const [erp, chat] = await Promise.all([
      queryAsAccount(
        context.userId,
        accountId,
        `DELETE FROM public.orcamentos_erp WHERE account_id = $1 RETURNING id`,
        [accountId],
      ),
      query(`DELETE FROM public.quotes WHERE account_id = $1 RETURNING id`, [accountId]),
    ]);
    await query(
      `DELETE FROM public.agent_source_sync_failures f
        USING public.agent_inbound_sources s, public.agent_personas p
        WHERE f.source_id = s.id AND p.id = s.agent_id
          AND f.account_id = $1 AND p.document_kind = 'orcamento'`,
      [accountId],
    );
    return { deleted: erp.length + chat.length };
  });

function requireAccountId(context: { accountId: string | null }): string {
  if (!context.accountId) throw new Error("Usuário sem conta associada.");
  return context.accountId;
}

// Orçamentos gerados pelo Bruno (Funcionário IA orçamentista de vidros).
// Lista e download de PDF para a tela /orcamentos.

import { createServerFn } from "@tanstack/react-start";
import { requireSessionAuth } from "@/lib/session-middleware";
import { z } from "zod";
import { query, getOne } from "@/lib/db";
import { fetchChatQuotes, fetchErpQuotes, type QuoteItem, type QuoteRow, type ErpQuoteRow } from "./quotes-data.server";

export type { QuoteItem, QuoteRow, ErpQuoteRow };

export const listBrunoQuotes = createServerFn({ method: "GET" })
  .middleware([requireSessionAuth])
  .inputValidator((d) => z.object({ accountId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const quotes = await fetchChatQuotes(data.accountId);
    return {
      quotes,
      totalValue: quotes.reduce((acc, q) => acc + q.total, 0),
    };
  });

/**
 * Orçamentos recebidos pelo webhook de integração (n8n → ERP) do Bruno —
 * ver Configurações > Webhooks > Recebimento > Templates por agente. Cada
 * linha é um contato da lista operacional `agent:<persona Bruno>`, com os
 * campos do ERP (numero_orcamento, valor_total, status_orcamento, ...)
 * gravados em `contacts.custom_attributes.ingest_variables` — não existe
 * tabela própria para isso, a integração escreve direto no contato (ver
 * `ingest_agent_contact`, AgentInboundUpsert20260730190000).
 */
export const listBrunoErpQuotes = createServerFn({ method: "GET" })
  .middleware([requireSessionAuth])
  .inputValidator((d) => z.object({ accountId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const quotes = await fetchErpQuotes(data.accountId);
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
      accountId: z.string().uuid(),
      quoteId: z.string().uuid(),
      customerName: z.string().max(200).nullable(),
      projectDescription: z.string().max(500).nullable(),
      status: z.enum(QUOTE_STATUSES),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const rows = await query(
      `UPDATE public.quotes
          SET customer_name = $3, project_description = $4, status = $5, updated_at = now()
        WHERE id = $1 AND account_id = $2
        RETURNING id`,
      [data.quoteId, data.accountId, data.customerName, data.projectDescription, data.status],
    );
    if (rows.length === 0) throw new Error("Orçamento não encontrado");
    return { ok: true };
  });

export const deleteQuote = createServerFn({ method: "POST" })
  .middleware([requireSessionAuth])
  .inputValidator((d) =>
    z.object({ accountId: z.string().uuid(), quoteId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const rows = await query(
      `DELETE FROM public.quotes WHERE id = $1 AND account_id = $2 RETURNING id`,
      [data.quoteId, data.accountId],
    );
    if (rows.length === 0) throw new Error("Orçamento não encontrado");
    return { ok: true };
  });

/** Edita o contato de um orçamento recebido do ERP — só telefone e email.
 * Os demais campos (nº, valor, datas, vendedor, status) vêm da integração e
 * não são editáveis aqui de propósito: são dado de origem do ERP, e deixar
 * corrigir à mão criaria divergência silenciosa com o sistema de origem.
 * Telefone/email são dado de contato — cabe ao time corrigir se o ERP
 * mandou errado. */
export const updateErpQuote = createServerFn({ method: "POST" })
  .middleware([requireSessionAuth])
  .inputValidator((d) =>
    z.object({
      accountId: z.string().uuid(),
      contactId: z.string().uuid(),
      phoneNumber: z.string().max(40).nullable(),
      email: z.string().max(200).nullable(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    let rows;
    try {
      rows = await query(
        `UPDATE public.contacts c
            SET phone_number = $3, email = $4, updated_at = now()
          WHERE c.id = $1 AND c.account_id = $2
          RETURNING c.id`,
        [data.contactId, data.accountId, data.phoneNumber, data.email],
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

/** "Exclui" um orçamento do ERP — remove o contato só da lista operacional
 * do Bruno. O contato em si não é apagado (pode ter conversas, ligações,
 * outras listas); é a mesma lógica de "sair da lista" que a exclusão de
 * lista operacional já usa em /listas. */
export const deleteErpQuote = createServerFn({ method: "POST" })
  .middleware([requireSessionAuth])
  .inputValidator((d) =>
    z.object({ accountId: z.string().uuid(), contactId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const rows = await query<{ list_id: string }>(
      `DELETE FROM public.contact_list_members m
        USING public.contact_lists l, public.agent_personas p
        WHERE m.list_id = l.id
          AND l.account_id = p.account_id AND p.name = 'Bruno'
          AND l.external_key = 'agent:' || p.id::text
          AND m.contact_id = $1 AND l.account_id = $2
        RETURNING l.id AS list_id`,
      [data.contactId, data.accountId],
    );
    if (rows.length === 0) throw new Error("Orçamento não encontrado");
    await query(
      `UPDATE public.contact_lists
          SET member_count = (SELECT count(*) FROM public.contact_list_members WHERE list_id = $1),
              updated_at = now()
        WHERE id = $1`,
      [rows[0].list_id],
    );
    return { ok: true };
  });

/** Bytes do PDF salvo para um orçamento, para download na tela. */
export const downloadQuotePdf = createServerFn({ method: "GET" })
  .middleware([requireSessionAuth])
  .inputValidator((d) =>
    z.object({ accountId: z.string().uuid(), quoteId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const row = await getOne<{ pdf_bytes: Buffer | null; customer_name: string | null }>(
      `SELECT pdf_bytes, customer_name FROM public.quotes WHERE id = $1 AND account_id = $2`,
      [data.quoteId, data.accountId],
    );
    if (!row || !row.pdf_bytes) throw new Error("Orçamento não encontrado");
    return {
      base64: Buffer.from(row.pdf_bytes).toString("base64"),
      filename: `orcamento-${(row.customer_name ?? data.quoteId).replace(/[^\w-]+/g, "_")}.pdf`,
    };
  });

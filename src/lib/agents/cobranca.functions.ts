// Cobranças (títulos em aberto) do Diego Cobrança — lista e edição de
// contato pra tela /cobrancas.

import { createServerFn } from "@tanstack/react-start";
import { requireSessionAuth } from "@/lib/session-middleware";
import { z } from "zod";
import { query, queryAsAccount } from "@/lib/db";
import { fetchCobrancaTitulos, type CobrancaRow } from "./cobranca-data.server";

export type { CobrancaRow };

// accountId nunca vem de `data` (client-supplied) — sempre de
// context.accountId, resolvido pela sessão em requireSessionAuth. Confiar no
// valor do body permitiria a qualquer usuário autenticado ler/editar/apagar
// cobranças de outra conta só trocando esse campo (IDOR entre tenants).
function requireAccountId(context: { accountId: string | null }): string {
  if (!context.accountId) throw new Error("Usuário sem conta associada.");
  return context.accountId;
}

export const listCobrancaTitulos = createServerFn({ method: "GET" })
  .middleware([requireSessionAuth])
  .inputValidator((d) => z.object({ accountId: z.string().uuid().optional() }).parse(d))
  .handler(async ({ context }) => {
    const accountId = requireAccountId(context);
    const titulos = await fetchCobrancaTitulos(context.userId, accountId);
    return {
      titulos,
      totalDevedor: titulos.reduce((acc, t) => acc + (t.valorDevedorSaldo ?? 0), 0),
    };
  });

/** Edita o contato de uma cobrança — só telefone e email, mesma regra de
 * Orçamentos: os demais campos vêm do ERP e não são editáveis aqui de
 * propósito (evita divergência silenciosa com o sistema de origem); dado de
 * empresa (razão social/nome fantasia/vendedor) edita-se pela Central de
 * Contatos. */
export const updateCobrancaContact = createServerFn({ method: "POST" })
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
      if (err instanceof Error && /contacts_account_id_email_key/.test(err.message)) {
        throw new Error("Este e-mail já pertence a outro contato desta conta.");
      }
      throw err;
    }
    if (rows.length === 0) throw new Error("Cobrança não encontrada");
    return { ok: true };
  });

/** Exclui um título — remove só aquela linha de `cobranca_titulos`. O
 * contato continua na lista operacional do Diego (e nos outros títulos que
 * ele tenha) independente de quantos títulos existiam antes. */
export const deleteCobrancaTitulo = createServerFn({ method: "POST" })
  .middleware([requireSessionAuth])
  .inputValidator((d) =>
    z.object({ accountId: z.string().uuid().optional(), tituloId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const accountId = requireAccountId(context);
    // cobranca_titulos tem FORCE ROW LEVEL SECURITY — precisa do contexto
    // de sessão (queryAsAccount), senão a policy nega e a linha nunca é
    // encontrada mesmo pertencendo à conta certa.
    const rows = await queryAsAccount(
      context.userId,
      accountId,
      `DELETE FROM public.cobranca_titulos WHERE id = $1 AND account_id = $2 RETURNING id`,
      [data.tituloId, accountId],
    );
    if (rows.length === 0) throw new Error("Título não encontrado");
    return { ok: true };
  });

/** Apaga TODOS os títulos de cobrança desta conta — reset da tela, não some
 * com os clientes/contatos, só com as linhas de `cobranca_titulos` e as
 * pendências da última sincronização. */
export const truncateCobrancaTitulos = createServerFn({ method: "POST" })
  .middleware([requireSessionAuth])
  .inputValidator((d) => z.object({ accountId: z.string().uuid().optional() }).parse(d))
  .handler(async ({ context }) => {
    const accountId = requireAccountId(context);
    const rows = await queryAsAccount(
      context.userId,
      accountId,
      `DELETE FROM public.cobranca_titulos WHERE account_id = $1 RETURNING id`,
      [accountId],
    );
    await query(
      `DELETE FROM public.agent_source_sync_failures f
        USING public.agent_inbound_sources s, public.agent_personas p
        WHERE f.source_id = s.id AND p.id = s.agent_id
          AND f.account_id = $1 AND p.document_kind = 'cobranca'`,
      [accountId],
    );
    return { deleted: rows.length };
  });

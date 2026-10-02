// Ações de servidor da tela "Novos clientes" (contatos importados por um
// agente específico). Mesmo padrão de truncateQuotes em quotes.functions.ts.

import { createServerFn } from "@tanstack/react-start";
import { requireSessionAuth } from "@/lib/session-middleware";
import { z } from "zod";
import { queryAsAccount } from "@/lib/db";

/**
 * Apaga todos os contatos importados por um agente específico (e cascateia
 * pra conversas, títulos, orçamentos etc. via FK ON DELETE CASCADE — ver
 * migration ContactSourceAgentId20260922010000). Diferente de
 * `truncateQuotes` (que não checa role — RLS de `quotes`/`orcamentos_erp`
 * não força para o dono da tabela), `contacts` é dado mais sensível
 * (PII, histórico de conversa/ligação junto): a checagem de admin aqui é
 * explícita na app, já que `contacts_delete_admin` (RLS) também não é
 * forçada para o pool de conexão do dono da tabela.
 */
export const truncateAgentContacts = createServerFn({ method: "POST" })
  .middleware([requireSessionAuth])
  .inputValidator((d) => z.object({ agentId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!context.accountId) throw new Error("Usuário sem conta associada.");
    if (context.membership?.role !== "admin") {
      throw new Error("Só administradores podem truncar contatos.");
    }
    const rows = await queryAsAccount(
      context.userId,
      context.accountId,
      `DELETE FROM public.contacts WHERE account_id = $1 AND source_agent_id = $2 RETURNING id`,
      [context.accountId, data.agentId],
    );
    return { deleted: rows.length };
  });

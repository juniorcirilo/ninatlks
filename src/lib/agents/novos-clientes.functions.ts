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
  .inputValidator((d) => z.object({ agentIds: z.array(z.string().uuid()).default([]) }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      return await run(data, context);
    } catch (e) {
      console.error("[truncateAgentContacts] falhou:", e);
      throw e;
    }
  });

async function run(
  data: { agentIds: string[] },
  context: { userId: string; accountId: string | null; membership?: { role?: string } | null },
) {
    if (!context.accountId) throw new Error("Usuário sem conta associada.");
    // `membership.role` vem de auth_get_primary_membership (LEFT JOIN em
    // user_roles + LIMIT 1, sem ORDER BY): com mais de um papel — ou nenhum —
    // um admin pode chegar aqui como "agent". Confere o papel direto no banco.
    const [adm] = await queryAsAccount<{ ok: boolean }>(
      context.userId,
      context.accountId,
      `SELECT public.has_role($1::uuid, $2::uuid, 'admin') AS ok`,
      [context.userId, context.accountId],
    );
    if (!adm?.ok) {
      throw new Error("Só administradores podem limpar contatos.");
    }
    // Persona(s) da Larissa: ids vindos da tela + qualquer persona da conta
    // com esse nome (a tela filtra por nome; o 1º contato pode vir sem id).
    const personas = await queryAsAccount<{ id: string }>(
      context.userId,
      context.accountId,
      `SELECT id FROM public.agent_personas
        WHERE account_id = $1 AND (id = ANY($2::uuid[]) OR name ~* '^larr?iss?a\\y')`,
      [context.accountId, data.agentIds],
    );
    const agentIds = personas.map((p) => p.id);
    if (agentIds.length === 0) return { deleted: 0 };
    const rows = await queryAsAccount(
      context.userId,
      context.accountId,
      `DELETE FROM public.contacts WHERE account_id = $1 AND source_agent_id = ANY($2::uuid[]) RETURNING id`,
      [context.accountId, agentIds],
    );
    await queryAsAccount(
      context.userId,
      context.accountId,
      `DELETE FROM public.agent_source_sync_failures f
        USING public.agent_inbound_sources s
        WHERE f.source_id = s.id AND f.account_id = $1 AND s.agent_id = ANY($2::uuid[])`,
      [context.accountId, agentIds],
    );
    return { deleted: rows.length };
}

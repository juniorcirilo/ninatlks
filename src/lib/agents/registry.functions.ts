import { createServerFn } from "@tanstack/react-start";
import { requireSessionAuth } from "@/lib/session-middleware";
import { z } from "zod";
import { query } from "@/lib/db";

// "bruno" | "ana" | "carla" têm loop de tools dedicado (ver bruno/ana/carla.functions.ts).
// Qualquer outro key é o uuid de uma persona real (tabela agent_personas, cadastrada em
// "Agentes de voz") e é conversada via askPersona (chat genérico, sem tools).
export type AgentKind = string;

export interface AgentSummary {
  key: AgentKind;
  name: string;
  description: string;
  kind: string;
  first_message: string;
  /**
   * Id da persona em agent_personas, quando o agente está instalado nesta
   * conta. É o identificador que as integrações usam — o `key` de um builtin é
   * só o slug do loop de tools, e não existe no banco.
   */
  persona_id?: string | null;
  /**
   * Campos de dados cadastrados para este agente (aba "Dados" da persona) —
   * ex.: dias_em_atraso, numero_orcamento. Quando vazio, quem consome cai de
   * volta no catálogo genérico por tipo de operação.
   */
  variable_schema?: Array<{ field: string; desc: string; required: boolean; example?: unknown }> | null;
}

const BUILTIN: AgentSummary[] = [
  { key: "bruno", name: "Bruno", kind: "orcamentista", description: "Orçamentista de vidros (UBVA). Catálogo, m², ferragens, PDF.", first_message: "Oi! Sou o Bruno, orçamentista. Me conta o que você precisa." },
  { key: "ana", name: "Ana", kind: "sdr", description: "SDR — qualifica leads, move pipeline, agenda reuniões.", first_message: "Oi! Sou a Ana. Posso te fazer 2 perguntinhas?" },
  { key: "carla", name: "Carla", kind: "cs", description: "Pós-venda — CSAT, retenção, escalação em casos críticos.", first_message: "Oi! Aqui é a Carla, do pós-venda." },
];

export const listAgents = createServerFn({ method: "POST" })
  .middleware([requireSessionAuth])
  .inputValidator((d) => z.object({ accountId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const names = BUILTIN.map((a) => a.name);
    const rows = await query<{
      id: string;
      name: string;
      description: string | null;
      first_message: string | null;
      variable_schema: Array<{ field: string; desc: string; required: boolean; example?: unknown }> | null;
    }>(
      `SELECT id, name, description, first_message, variable_schema FROM agent_personas WHERE account_id = $1 ORDER BY updated_at DESC`,
      [data.accountId],
    );
    // Map em vez de Set: além de "está instalado?", quem consome precisa do id
    // da persona — é ele que identifica o agente nas integrações.
    const installed = new Map(
      rows.filter((r) => names.includes(r.name)).map((r) => [r.name, r] as const),
    );
    const custom = rows
      .filter((r) => !names.includes(r.name))
      .map((r) => ({
        key: r.id,
        name: r.name,
        kind: "custom",
        description: r.description ?? "Agente de voz cadastrado.",
        first_message: r.first_message ?? `Oi! Sou ${r.name}.`,
        installed: true,
        persona_id: r.id,
        variable_schema: r.variable_schema ?? [],
      }));
    return {
      agents: [
        ...BUILTIN.map((a) => {
          const row = installed.get(a.name);
          return {
            ...a,
            installed: !!row,
            persona_id: row?.id ?? null,
            variable_schema: row?.variable_schema ?? [],
          };
        }),
        ...custom,
      ],
    };
  });

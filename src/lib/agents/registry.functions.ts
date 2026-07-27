import { createServerFn } from "@tanstack/react-start";
import { requireSessionAuth } from "@/lib/session-middleware";
import { z } from "zod";
import { query } from "@/lib/db";

export type AgentKind = "bruno" | "ana" | "carla" | "clara" | "diego" | "elena" | "felipe";

export interface AgentSummary {
  key: AgentKind;
  name: string;
  description: string;
  kind: string;
  first_message: string;
}

const BUILTIN: AgentSummary[] = [
  { key: "bruno", name: "Bruno", kind: "orcamentista", description: "Orçamentista de vidros (UBVA). Catálogo, m², ferragens, PDF.", first_message: "Oi! Sou o Bruno, orçamentista. Me conta o que você precisa." },
  { key: "ana", name: "Ana", kind: "sdr", description: "SDR — qualifica leads, move pipeline, agenda reuniões.", first_message: "Oi! Sou a Ana. Posso te fazer 2 perguntinhas?" },
  { key: "carla", name: "Carla", kind: "cs", description: "Pós-venda — CSAT, retenção, escalação em casos críticos.", first_message: "Oi! Aqui é a Carla, do pós-venda." },
  { key: "clara", name: "Clara", kind: "suporte", description: "Suporte técnico — diagnóstico, troubleshooting, abertura de chamados.", first_message: "Oi! Sou a Clara, do suporte técnico. Me descreve o problema?" },
  { key: "diego", name: "Diego", kind: "cobranca", description: "Cobrança — promessas de pagamento, 2ª via, parcelamento.", first_message: "Olá! Aqui é o Diego, do financeiro." },
  { key: "elena", name: "Elena", kind: "marketing", description: "Marketing — cadências, conteúdo, reativação de base.", first_message: "Oi! Sou a Elena, do marketing." },
  { key: "felipe", name: "Felipe", kind: "logistica", description: "Logística — agenda entrega e instalação.", first_message: "Olá! Sou o Felipe, da logística. Vamos combinar a entrega?" },
];

export const listAgents = createServerFn({ method: "POST" })
  .middleware([requireSessionAuth])
  .inputValidator((d) => z.object({ accountId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const names = BUILTIN.map((a) => a.name);
    const rows = await query(
      `SELECT id, name, status FROM agent_personas WHERE account_id = $1 AND name = ANY($2)`,
      [data.accountId, names],
    );
    const installed = new Set(rows.map((r: any) => r.name));
    return {
      agents: BUILTIN.map((a) => ({ ...a, installed: installed.has(a.name) })),
    };
  });

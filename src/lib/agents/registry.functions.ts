// Lista as personas IA do workspace para a UI de playground/seleção.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ accountId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const names = BUILTIN.map((a) => a.name);
    const { data: rows } = await supabaseAdmin
      .from("agent_personas")
      .select("id, name, status")
      .eq("account_id", data.accountId)
      .in("name", names);
    const installed = new Set((rows ?? []).map((r) => r.name));
    return {
      agents: BUILTIN.map((a) => ({ ...a, installed: installed.has(a.name) })),
    };
  });

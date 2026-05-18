// Lista as personas IA do workspace para a UI de playground/seleção.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AgentKind = "bruno" | "ana" | "carla";

export interface AgentSummary {
  key: AgentKind;
  name: string;
  description: string;
  kind: string;
  first_message: string;
}

const BUILTIN: AgentSummary[] = [
  { key: "bruno", name: "Bruno", kind: "orcamentista", description: "Orçamentista de vidros (UBVA). Catálogo, m², ferragens.", first_message: "Oi! Sou o Bruno, orçamentista. Me conta o que você precisa." },
  { key: "ana", name: "Ana", kind: "sdr", description: "SDR — qualifica leads, move pipeline, agenda reuniões.", first_message: "Oi! Sou a Ana. Posso te fazer 2 perguntinhas?" },
  { key: "carla", name: "Carla", kind: "cs", description: "Pós-venda — CSAT, retenção, escalação em casos críticos.", first_message: "Oi! Aqui é a Carla, do pós-venda." },
];

export const listAgents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ accountId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { data: rows } = await supabaseAdmin
      .from("agent_personas")
      .select("id, name, status")
      .eq("account_id", data.accountId)
      .in("name", ["Bruno", "Ana", "Carla"]);
    const installed = new Set((rows ?? []).map((r) => r.name));
    return {
      agents: BUILTIN.map((a) => ({ ...a, installed: installed.has(a.name) })),
    };
  });

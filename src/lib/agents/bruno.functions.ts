// Bruno — Orçamentista de Vidros (Fase 3, primeiro Funcionário IA).
//
// Roda em loop de tool calling contra o Lovable AI Gateway (OpenAI-compatible).
// Tools disponíveis:
//   - search_glass: consulta catálogo de vidros por categoria/espessura
//   - list_fittings: lista ferragens compatíveis com espessura
//   - calculate_quote: calcula orçamento (vidros × m² + ferragens × qtde + margem)
//   - request_handoff: registra handoff para humano ou outra persona
//
// Saída: texto final do agente + estrutura de ações executadas (tool calls + handoff).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { generateQuotePdfBuffer, uploadQuotePdf, validateNbr, type GlassUsage } from "./bruno-pdf.server";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";
const MAX_STEPS = 6;

// ===================== TOOL EXECUTORS =====================

type GlassRow = {
  sku: string;
  name: string;
  category: string;
  thickness_mm: number;
  price_per_m2: number;
  nbr_reference: string | null;
};
type FittingRow = {
  sku: string;
  name: string;
  category: string;
  unit: string;
  price: number;
  compatible_thickness_mm: number[];
  finish: string | null;
};

async function execSearchGlass(accountId: string, args: { category?: string; thickness_mm?: number }) {
  let q = supabaseAdmin
    .from("glass_types")
    .select("sku, name, category, thickness_mm, price_per_m2, nbr_reference")
    .eq("account_id", accountId)
    .eq("active", true)
    .order("category")
    .order("thickness_mm");
  if (args.category) q = q.eq("category", args.category);
  if (args.thickness_mm) q = q.eq("thickness_mm", args.thickness_mm);
  const { data, error } = await q.limit(20);
  if (error) return { error: error.message };
  return { results: data ?? [] };
}

async function execListFittings(accountId: string, args: { thickness_mm?: number; category?: string }) {
  let q = supabaseAdmin
    .from("glass_fittings")
    .select("sku, name, category, unit, price, compatible_thickness_mm, finish")
    .eq("account_id", accountId)
    .eq("active", true);
  if (args.category) q = q.eq("category", args.category);
  const { data, error } = await q.limit(50);
  if (error) return { error: error.message };
  let rows = (data ?? []) as FittingRow[];
  if (args.thickness_mm) {
    rows = rows.filter((r) => r.compatible_thickness_mm.map(Number).includes(args.thickness_mm!));
  }
  return { results: rows };
}

interface QuoteLine {
  sku: string;
  qty: number; // m² para vidro, unidades/metros para ferragens
  margin_pct?: number;
}

async function execCalculateQuote(
  accountId: string,
  args: { glasses: QuoteLine[]; fittings: QuoteLine[]; global_margin_pct?: number },
) {
  const skus = [...args.glasses.map((g) => g.sku), ...args.fittings.map((f) => f.sku)];
  if (skus.length === 0) return { error: "lista vazia" };

  const [{ data: gs }, { data: fs }] = await Promise.all([
    supabaseAdmin
      .from("glass_types")
      .select("sku, name, price_per_m2, min_m2_per_piece")
      .eq("account_id", accountId)
      .in("sku", args.glasses.map((g) => g.sku)),
    supabaseAdmin
      .from("glass_fittings")
      .select("sku, name, price, unit")
      .eq("account_id", accountId)
      .in("sku", args.fittings.map((f) => f.sku)),
  ]);

  const items: Array<{ sku: string; name: string; qty: number; unit_price: number; subtotal: number; kind: string }> = [];
  let subtotal = 0;

  for (const g of args.glasses) {
    const ref = (gs ?? []).find((x) => x.sku === g.sku);
    if (!ref) { items.push({ sku: g.sku, name: "(não encontrado)", qty: g.qty, unit_price: 0, subtotal: 0, kind: "glass" }); continue; }
    const qty = Math.max(g.qty, Number(ref.min_m2_per_piece ?? 0.5));
    const sub = qty * Number(ref.price_per_m2);
    subtotal += sub;
    items.push({ sku: g.sku, name: ref.name, qty, unit_price: Number(ref.price_per_m2), subtotal: sub, kind: "glass_m2" });
  }
  for (const f of args.fittings) {
    const ref = (fs ?? []).find((x) => x.sku === f.sku);
    if (!ref) { items.push({ sku: f.sku, name: "(não encontrado)", qty: f.qty, unit_price: 0, subtotal: 0, kind: "fitting" }); continue; }
    const sub = f.qty * Number(ref.price);
    subtotal += sub;
    items.push({ sku: f.sku, name: ref.name, qty: f.qty, unit_price: Number(ref.price), subtotal: sub, kind: `fitting_${ref.unit}` });
  }

  const margin = Math.max(0, Math.min(100, args.global_margin_pct ?? 0));
  const total = subtotal * (1 + margin / 100);
  return {
    currency: "BRL",
    items,
    subtotal: Number(subtotal.toFixed(2)),
    margin_pct: margin,
    total: Number(total.toFixed(2)),
  };
}

async function execRequestHandoff(
  accountId: string,
  conversationId: string | null,
  fromPersonaId: string | null,
  args: { reason: string; target: "human" | "persona"; target_persona_id?: string },
) {
  if (!conversationId) return { ok: false, error: "sem conversa ativa" };
  const { data, error } = await supabaseAdmin
    .from("agent_handoffs")
    .insert([{
      account_id: accountId,
      conversation_id: conversationId,
      from_persona_id: fromPersonaId,
      to_persona_id: args.target === "persona" ? args.target_persona_id ?? null : null,
      to_human_user_id: null, // designado pela fila de assignment
      reason: args.reason,
      context: { requested_by: "bruno", target: args.target },
    }])
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, handoff_id: data.id };
}

// ===================== TOOL SCHEMAS (OpenAI-compatible) =====================

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_glass",
      description: "Consulta o catálogo de vidros do workspace. Filtra por categoria (temperado/laminado/espelho/comum) e/ou espessura em mm.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", enum: ["temperado", "laminado", "espelho", "comum"] },
          thickness_mm: { type: "number", description: "Espessura em mm (ex: 6, 8, 10)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_fittings",
      description: "Lista ferragens (dobradiças, puxadores, fechaduras, kits, perfis). Filtra por compatibilidade com espessura e/ou categoria.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", enum: ["dobradica", "puxador", "fechadura", "kit", "perfil"] },
          thickness_mm: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate_quote",
      description: "Calcula um orçamento estruturado a partir de itens de vidro (com m²) e ferragens (com quantidade). Aplica margem global percentual.",
      parameters: {
        type: "object",
        properties: {
          glasses: {
            type: "array",
            items: { type: "object", properties: { sku: { type: "string" }, qty: { type: "number" } }, required: ["sku", "qty"] },
          },
          fittings: {
            type: "array",
            items: { type: "object", properties: { sku: { type: "string" }, qty: { type: "number" } }, required: ["sku", "qty"] },
          },
          global_margin_pct: { type: "number", description: "Margem global em %, ex: 35" },
        },
        required: ["glasses", "fittings"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_handoff",
      description: "Solicita transferência da conversa para um humano (vendas/técnico) quando: cliente pede pessoa, situação foge do orçamento simples, ou faltam dados que só humano resolve.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string" },
          target: { type: "string", enum: ["human", "persona"] },
          target_persona_id: { type: "string", description: "uuid da persona alvo se target=persona" },
        },
        required: ["reason", "target"],
      },
    },
  },
];

const BRUNO_SYSTEM = `Você é o **Bruno**, orçamentista de vidros da UBVA. Atende clientes finais e vidraceiros parceiros.

REGRAS:
- Sempre responda em português brasileiro, com tom técnico-amigável (você é vidraceiro experiente, não vendedor de telemarketing).
- NUNCA invente preços ou SKUs. Sempre use a tool \`search_glass\` ou \`list_fittings\` antes de citar valores.
- Quando o cliente descrever o projeto (ex: "box de banheiro 1,2m x 1,9m"), calcule m² (largura × altura) e use \`calculate_quote\`.
- Margem padrão da UBVA: 35% sobre o custo. Pode subir até 50% se cliente pedir entrega expressa.
- Para projetos de fachada, sacada, guarda-corpo: vidro laminado é OBRIGATÓRIO (NBR 7199). Avise o cliente.
- Vidro temperado é o padrão para box, mesas e divisórias internas.
- Espessuras mínimas: box 8mm, divisória 10mm, fachada 4+4 laminado.
- Se o cliente quiser falar com humano OU pedir algo fora do seu escopo (entrega complexa, garantia, projeto especial >R$10k), chame \`request_handoff\` com target="human".
- Apresente orçamentos em formato claro: itens com qtd × preço, subtotal, margem, total.
- Não use markdown pesado em respostas curtas; use só em orçamentos formais.`;

// ===================== AGENT LOOP =====================

interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
}

export const askBruno = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      accountId: z.string().uuid(),
      userMessage: z.string().min(1).max(2000),
      conversationId: z.string().uuid().optional(),
      history: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })).max(20).default([]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;

    // Acha persona "Bruno" (cria sob demanda na primeira chamada).
    const personaId = await ensureBrunoPersona(data.accountId, userId);

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY não configurado");

    const messages: AgentMessage[] = [
      { role: "system", content: BRUNO_SYSTEM },
      ...data.history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: data.userMessage },
    ];

    // trace serializável: args/result como JSON strings (TanStack serverFn exige tipos concretos)
    const trace: Array<{ tool: string; args: string; result: string }> = [];

    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await fetch(GATEWAY, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.4,
          messages,
          tools: TOOLS,
          tool_choice: "auto",
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Gateway ${res.status}: ${body.slice(0, 200)}`);
      }
      const json = await res.json();
      const choice = json.choices?.[0];
      const msg = choice?.message;
      if (!msg) throw new Error("Resposta inválida do gateway");

      // Sem tool calls → resposta final.
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        return {
          reply: (msg.content as string) ?? "",
          trace,
          personaId,
          steps: step + 1,
        };
      }

      // Empurra a mensagem do assistente (com tool_calls).
      messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });

      // Executa cada tool call em paralelo.
      const results = await Promise.all(msg.tool_calls.map(async (tc: AgentMessage["tool_calls"] extends (infer U)[] | undefined ? U : never) => {
        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(tc.function.arguments || "{}"); } catch { /* keep empty */ }
        let result: unknown;
        switch (tc.function.name) {
          case "search_glass":
            result = await execSearchGlass(data.accountId, parsed as { category?: string; thickness_mm?: number });
            break;
          case "list_fittings":
            result = await execListFittings(data.accountId, parsed as { category?: string; thickness_mm?: number });
            break;
          case "calculate_quote":
            result = await execCalculateQuote(data.accountId, parsed as Parameters<typeof execCalculateQuote>[1]);
            break;
          case "request_handoff":
            result = await execRequestHandoff(
              data.accountId,
              data.conversationId ?? null,
              personaId,
              parsed as { reason: string; target: "human" | "persona"; target_persona_id?: string },
            );
            break;
          default:
            result = { error: `tool desconhecida: ${tc.function.name}` };
        }
        trace.push({ tool: tc.function.name, args: JSON.stringify(parsed), result: JSON.stringify(result) });
        return { tc, result };
      }));

      for (const { tc, result } of results) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          name: tc.function.name,
          content: JSON.stringify(result),
        });
      }
    }

    return { reply: "(limite de passos atingido sem resposta final)", trace, personaId, steps: MAX_STEPS };
  });

// ===================== PERSONA SEEDER =====================

async function ensureBrunoPersona(accountId: string, _createdByUserId: string): Promise<string> {
  // Já existe?
  const { data: existing } = await supabaseAdmin
    .from("agent_personas")
    .select("id")
    .eq("account_id", accountId)
    .eq("name", "Bruno")
    .maybeSingle();
  if (existing) return existing.id;

  const { data: persona, error } = await supabaseAdmin
    .from("agent_personas")
    .insert([{
      account_id: accountId,
      name: "Bruno",
      description: "Orçamentista de vidros — UBVA",
      system_prompt: BRUNO_SYSTEM,
      status: "active",
      enabled: true,
      llm_model: MODEL,
      llm_temperature: 0.4,
      llm_max_tokens: 800,
      first_message: "Oi! Sou o Bruno, orçamentista aqui da UBVA. Me conta o que você precisa que eu já tiro o preço.",
    }])
    .select("id")
    .single();
  if (error) throw new Error(`seed persona: ${error.message}`);

  await supabaseAdmin
    .from("agent_roles")
    .insert([{
      account_id: accountId,
      persona_id: persona.id,
      kind: "orcamentista",
      display_name: "Bruno — Orçamentista",
      description: "Calcula orçamentos de vidros e ferragens; pede handoff humano em casos complexos.",
      allowed_tools: ["search_glass", "list_fittings", "calculate_quote", "request_handoff"],
      handoff_targets: [],
      handoff_rules: [
        { when: "cliente pede humano", action: "handoff_human" },
        { when: "orçamento > R$10.000", action: "handoff_human" },
      ],
      daily_message_budget: 1000,
    }]);

  return persona.id;
}

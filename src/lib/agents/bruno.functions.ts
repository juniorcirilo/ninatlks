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
import { requireSessionAuth } from "@/lib/session-middleware";
import { z } from "zod";
import { query, getOne, insert } from "@/lib/db";
import { generateQuotePdfBuffer, saveQuote, validateNbr, type GlassUsage } from "./bruno-pdf.server";
import { resolveLlmConfig } from "./llm-config";
import { callChatCompletion } from "./providers";
import type { ToolDef } from "./runner";

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
  const where: string[] = ["account_id = $1", "active = true"];
  const params: unknown[] = [accountId];
  if (args.category) { params.push(args.category); where.push(`category = $${params.length}`); }
  if (args.thickness_mm) { params.push(args.thickness_mm); where.push(`thickness_mm = $${params.length}`); }
  const data = await query<GlassRow>(
    `SELECT sku, name, category, thickness_mm, price_per_m2, nbr_reference
     FROM glass_types WHERE ${where.join(" AND ")} ORDER BY category, thickness_mm LIMIT 20`,
    params,
  );
  return { results: data };
}

async function execListFittings(accountId: string, args: { thickness_mm?: number; category?: string }) {
  const where: string[] = ["account_id = $1", "active = true"];
  const params: unknown[] = [accountId];
  if (args.category) { params.push(args.category); where.push(`category = $${params.length}`); }
  let rows = (await query<FittingRow>(
    `SELECT sku, name, category, unit, price, compatible_thickness_mm, finish
     FROM glass_fittings WHERE ${where.join(" AND ")} LIMIT 50`,
    params,
  )) as FittingRow[];
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
  args: {
    glasses: QuoteLine[];
    fittings: QuoteLine[];
    global_margin_pct?: number;
    usage_type?: GlassUsage;
  },
) {
  const skus = [...args.glasses.map((g) => g.sku), ...args.fittings.map((f) => f.sku)];
  if (skus.length === 0) return { error: "lista vazia" };

  const [gs, fs] = await Promise.all([
    query(
      `SELECT sku, name, category, thickness_mm, price_per_m2, min_m2_per_piece
       FROM glass_types WHERE account_id = $1 AND sku = ANY($2)`,
      [accountId, args.glasses.map((g) => g.sku)],
    ),
    query(
      `SELECT sku, name, price, unit
       FROM glass_fittings WHERE account_id = $1 AND sku = ANY($2)`,
      [accountId, args.fittings.map((f) => f.sku)],
    ),
  ]);

  // NBR 7199 / 14207 enforcement
  const usage = args.usage_type ?? "outro";
  const glassMeta = args.glasses.map((g) => {
    const ref = gs.find((x) => x.sku === g.sku);
    return { sku: g.sku, category: ref?.category, thickness_mm: ref?.thickness_mm };
  });
  const nbr = validateNbr({ usage, glasses: glassMeta });
  if (!nbr.ok) {
    return {
      error: "violação de norma técnica",
      blockers: nbr.blockers,
      warnings: nbr.warnings,
      usage_type: usage,
    };
  }

  const items: Array<{ sku: string; name: string; qty: number; unit_price: number; subtotal: number; kind: string }> = [];
  let subtotal = 0;

  for (const g of args.glasses) {
    const ref = gs.find((x) => x.sku === g.sku);
    if (!ref) { items.push({ sku: g.sku, name: "(não encontrado)", qty: g.qty, unit_price: 0, subtotal: 0, kind: "glass" }); continue; }
    const qty = Math.max(g.qty, Number(ref.min_m2_per_piece ?? 0.5));
    const sub = qty * Number(ref.price_per_m2);
    subtotal += sub;
    items.push({ sku: g.sku, name: ref.name, qty, unit_price: Number(ref.price_per_m2), subtotal: sub, kind: "glass_m2" });
  }
  for (const f of args.fittings) {
    const ref = fs.find((x) => x.sku === f.sku);
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
    usage_type: usage,
    nbr_warnings: nbr.warnings,
  };
}

async function execGenerateQuotePdf(
  accountId: string,
  personaId: string | null,
  conversationId: string | null,
  args: {
    customer_name?: string;
    project_description?: string;
    items: Array<{ sku: string; name: string; qty: number; unit_price: number; subtotal: number; kind: string }>;
    subtotal: number;
    margin_pct: number;
    total: number;
    nbr_notes?: string[];
    validity_days?: number;
  },
) {
  if (!args.items?.length) return { error: "sem itens para PDF" };
  try {
    const buf = await generateQuotePdfBuffer({
      accountId,
      customerName: args.customer_name,
      projectDescription: args.project_description,
      items: args.items,
      subtotal: args.subtotal,
      marginPct: args.margin_pct,
      total: args.total,
      nbrNotes: args.nbr_notes,
      validityDays: args.validity_days,
    });
    const { id } = await saveQuote({
      accountId,
      personaId,
      conversationId,
      customerName: args.customer_name,
      projectDescription: args.project_description,
      items: args.items,
      subtotal: args.subtotal,
      marginPct: args.margin_pct,
      total: args.total,
      nbrNotes: args.nbr_notes,
      validityDays: args.validity_days,
      pdf: buf,
    });
    return { ok: true, quote_id: id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function execRequestHandoff(
  accountId: string,
  conversationId: string | null,
  fromPersonaId: string | null,
  args: { reason: string; target: "human" | "persona"; target_persona_id?: string },
) {
  if (!conversationId) return { ok: false, error: "sem conversa ativa" };
  try {
    const [row] = await insert<{ id: string }>("agent_handoffs", {
      account_id: accountId,
      conversation_id: conversationId,
      from_persona_id: fromPersonaId,
      to_persona_id: args.target === "persona" ? args.target_persona_id ?? null : null,
      to_human_user_id: null, // designado pela fila de assignment
      reason: args.reason,
      context: { requested_by: "bruno", target: args.target },
    });
    return { ok: true, handoff_id: row.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ===================== TOOL SCHEMAS (OpenAI-compatible) =====================

const TOOLS: ToolDef[] = [
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
      description: "Calcula um orçamento estruturado a partir de itens de vidro (com m²) e ferragens (com quantidade). Aplica margem global percentual. Valida NBR 7199/14207 conforme o tipo de uso (usage_type).",
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
          usage_type: {
            type: "string",
            enum: ["box", "divisoria_interna", "mesa", "espelho", "fachada", "sacada", "guarda_corpo", "cobertura", "outro"],
            description: "Aplicação do vidro — usado para validar NBR 7199 (laminado obrigatório em fachada/sacada/guarda-corpo/cobertura) e NBR 14207 (box ≥8mm temperado).",
          },
        },
        required: ["glasses", "fittings"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_quote_pdf",
      description: "Gera o PDF do orçamento (após calculate_quote ter aprovado) e salva no painel, na tela Orçamentos. Use APÓS confirmar o cálculo com o cliente.",
      parameters: {
        type: "object",
        properties: {
          customer_name: { type: "string" },
          project_description: { type: "string", description: "Resumo curto do projeto (ex: 'Box frontal 1.2m x 1.9m incolor 8mm')." },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                sku: { type: "string" }, name: { type: "string" },
                qty: { type: "number" }, unit_price: { type: "number" },
                subtotal: { type: "number" }, kind: { type: "string" },
              },
              required: ["sku", "name", "qty", "unit_price", "subtotal", "kind"],
            },
          },
          subtotal: { type: "number" },
          margin_pct: { type: "number" },
          total: { type: "number" },
          nbr_notes: { type: "array", items: { type: "string" }, description: "Observações técnicas (NBR) que apareceram no calculate_quote." },
          validity_days: { type: "number", description: "Padrão 7." },
        },
        required: ["items", "subtotal", "margin_pct", "total"],
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
- Quando o cliente descrever o projeto (ex: "box de banheiro 1,2m x 1,9m"), calcule m² (largura × altura) e use \`calculate_quote\` SEMPRE passando \`usage_type\` (box, fachada, sacada, guarda_corpo, divisoria_interna, mesa, espelho, cobertura, outro). O sistema valida a NBR 7199/14207 e BLOQUEIA o cálculo se a configuração for ilegal.
- Se \`calculate_quote\` retornar \`error: "violação de norma técnica"\`, releia os \`blockers\`, sugira ao cliente o vidro correto (ex: trocar temperado por laminado em fachada) e refaça o cálculo.
- Margem padrão da UBVA: 35% sobre o custo. Pode subir até 50% se cliente pedir entrega expressa.
- Após o cliente APROVAR o valor, ofereça gerar o PDF e chame \`generate_quote_pdf\` com os mesmos itens — confirme ao cliente que o orçamento foi salvo e está disponível no painel, em Orçamentos.
- Espessuras mínimas (referência): box 8mm temperado, divisória interna 10mm, fachada/sacada/guarda-corpo 4+4 laminado.
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
  .middleware([requireSessionAuth])
  .inputValidator((d) =>
    z.object({
      // accountId aceito por compatibilidade com chamadores existentes, mas
      // nunca usado — vem sempre de context.accountId (sessão), nunca do
      // body: usar o valor do client permitiria a um usuário de qualquer
      // conta rodar tools do Bruno (preços, catálogo, orçamentos) contra os
      // dados de outra conta só trocando esse campo.
      accountId: z.string().uuid().optional(),
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
    if (!context.accountId) throw new Error("Usuário sem conta associada.");
    const accountId = context.accountId;

    // Acha persona "Bruno" (cria sob demanda na primeira chamada).
    const personaId = await ensureBrunoPersona(accountId, userId);

    const llm = await resolveLlmConfig(accountId, MODEL);

    const messages: AgentMessage[] = [
      { role: "system", content: BRUNO_SYSTEM },
      ...data.history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: data.userMessage },
    ];

    // trace serializável: args/result como JSON strings (TanStack serverFn exige tipos concretos)
    const trace: Array<{ tool: string; args: string; result: string }> = [];

    for (let step = 0; step < MAX_STEPS; step++) {
      const msg = await callChatCompletion({
        provider: llm.provider,
        baseUrl: llm.baseUrl,
        apiKey: llm.apiKey,
        model: llm.model,
        temperature: 0.4,
        messages,
        tools: TOOLS,
      });

      // Sem tool calls → resposta final.
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        return {
          reply: msg.content ?? "",
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
            result = await execSearchGlass(accountId, parsed as { category?: string; thickness_mm?: number });
            break;
          case "list_fittings":
            result = await execListFittings(accountId, parsed as { category?: string; thickness_mm?: number });
            break;
          case "calculate_quote":
            result = await execCalculateQuote(accountId, parsed as Parameters<typeof execCalculateQuote>[1]);
            break;
          case "generate_quote_pdf":
            result = await execGenerateQuotePdf(
              accountId,
              personaId,
              data.conversationId ?? null,
              parsed as Parameters<typeof execGenerateQuotePdf>[3],
            );
            break;
          case "request_handoff":
            result = await execRequestHandoff(
              accountId,
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
  const existing = await getOne<{ id: string }>(
    `SELECT id FROM agent_personas WHERE account_id = $1 AND name = $2`,
    [accountId, "Bruno"],
  );
  if (existing) return existing.id;

  const [persona] = await insert<{ id: string }>("agent_personas", {
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
  });

  await insert("agent_roles", {
    account_id: accountId,
    persona_id: persona.id,
    kind: "orcamentista",
    display_name: "Bruno — Orçamentista",
    description: "Calcula orçamentos de vidros e ferragens; pede handoff humano em casos complexos.",
    allowed_tools: ["search_glass", "list_fittings", "calculate_quote", "generate_quote_pdf", "request_handoff"],
    handoff_targets: [],
    handoff_rules: [
      { when: "cliente pede humano", action: "handoff_human" },
      { when: "orçamento > R$10.000", action: "handoff_human" },
    ],
    daily_message_budget: 1000,
  });

  return persona.id;
}

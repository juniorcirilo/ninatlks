// Supervisor — orquestrador multi-agente.
// Recebe a mensagem inicial do cliente, classifica a INTENÇÃO em uma única
// chamada barata ao gateway (Gemini Flash Lite) e responde com a persona alvo.
// Não conversa; só roteia. Quem conversa é Bruno/Ana/Carla.
//
// Saída: { route: "bruno" | "ana" | "carla" | "human", confidence, reason }

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash-lite";

const ROUTE_VALUES = ["bruno", "ana", "carla", "human"] as const;
type Route = (typeof ROUTE_VALUES)[number];

const SYSTEM = `Você é o **Supervisor** da Nexus. Sua ÚNICA função é decidir, em UMA palavra, qual agente atende a mensagem do cliente.

OPÇÕES:
- "bruno"  → cliente pergunta sobre preço, orçamento, vidro, ferragem, medidas, m², ferragens, kit box.
- "ana"    → cliente é novo (não comprou ainda), pergunta sobre o produto/empresa, demonstração, quer marcar reunião, qualificação.
- "carla"  → cliente já comprou ou já teve reunião, dá feedback, reclama, pede status de pedido, pós-venda.
- "human"  → cliente está irritado, pede explicitamente humano, ameaça processo, ou caso fora dos escopos acima.

REGRAS:
- Responda APENAS com JSON: { "route": "<um dos valores>", "confidence": 0.0-1.0, "reason": "frase curta" }
- Não converse. Não saude. Não pergunte. Não use markdown.`;

export const routeMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      userMessage: z.string().min(1).max(2000),
      contextHints: z.object({
        hasOrder: z.boolean().optional(),
        hadMeeting: z.boolean().optional(),
        isReturningCustomer: z.boolean().optional(),
      }).optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY não configurado");

    const hints = data.contextHints
      ? `\n[contexto: ${JSON.stringify(data.contextHints)}]`
      : "";

    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: data.userMessage + hints },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("Limite de uso do gateway atingido.");
      if (res.status === 402) throw new Error("Créditos do Lovable AI esgotados.");
      throw new Error(`Gateway ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = await res.json();
    const raw = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: { route?: string; confidence?: number; reason?: string } = {};
    try { parsed = JSON.parse(raw); } catch { /* fallback abaixo */ }

    const route: Route = ROUTE_VALUES.includes(parsed.route as Route)
      ? (parsed.route as Route)
      : "ana"; // fallback seguro: novo lead → SDR
    const confidence = typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5;
    const reason = (parsed.reason ?? "").slice(0, 200) || "fallback para SDR";

    return { route, confidence, reason };
  });

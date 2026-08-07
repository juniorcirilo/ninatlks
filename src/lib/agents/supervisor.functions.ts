// Supervisor — orquestrador multi-agente.
// Recebe a mensagem inicial do cliente, classifica a INTENÇÃO em uma única
// chamada barata ao gateway (Gemini Flash Lite) e responde com a persona alvo.
// Não conversa; só roteia. Quem conversa é Bruno/Ana/Carla.
//
// Saída: { route: "bruno" | "ana" | "carla" | "human", confidence, reason }

import { createServerFn } from "@tanstack/react-start";
import { requireSessionAuth } from "@/lib/session-middleware";
import { z } from "zod";
import { resolveLlmConfig } from "./llm-config";
import { callChatCompletion } from "./providers";

const MODEL = "google/gemini-2.5-flash-lite";

const ROUTE_VALUES = ["bruno", "ana", "carla", "clara", "diego", "elena", "felipe", "human"] as const;
type Route = (typeof ROUTE_VALUES)[number];

const SYSTEM = `Você é o **Supervisor** da Nexus. Sua ÚNICA função é decidir, em UMA palavra, qual agente atende a mensagem do cliente.

OPÇÕES:
- "bruno"   → preço, orçamento, vidro, ferragem, medidas, m², kit box, PDF de proposta.
- "ana"     → lead novo, qualificação, agendar demo/reunião comercial.
- "carla"   → pós-venda geral, CSAT, retenção, feedback após compra.
- "clara"   → problema técnico, defeito, instalação com falha, troubleshooting.
- "diego"   → boleto, 2ª via, atraso de pagamento, negociar parcelamento.
- "elena"   → cliente quer receber novidades, conteúdo, campanha, reativação.
- "felipe"  → combinar data/horário de entrega ou instalação, endereço.
- "human"   → cliente irritado, ameaça, fora dos escopos acima, ou pede humano.

REGRAS:
- Responda APENAS com JSON: { "route": "<um dos valores>", "confidence": 0.0-1.0, "reason": "frase curta" }
- Não converse. Não saude. Não pergunte. Não use markdown.`;

export const routeMessage = createServerFn({ method: "POST" })
  .middleware([requireSessionAuth])
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
  .handler(async ({ data, context }) => {
    if (!context.accountId) throw new Error("Sem conta ativa na sessão.");
    const llm = await resolveLlmConfig(context.accountId, MODEL);

    const hints = data.contextHints
      ? `\n[contexto: ${JSON.stringify(data.contextHints)}]`
      : "";

    const msg = await callChatCompletion({
      provider: llm.provider,
      baseUrl: llm.baseUrl,
      apiKey: llm.apiKey,
      model: llm.model,
      temperature: 0,
      jsonMode: true,
      tools: [],
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: data.userMessage + hints },
      ],
    });

    const raw = msg.content || "{}";
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

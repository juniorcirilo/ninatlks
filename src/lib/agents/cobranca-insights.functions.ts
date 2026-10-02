// Análise de cobranças por IA — quais títulos precisam de intervenção e
// leitura de métricas/tendências. Mesmo padrão de quotes-insights.functions.ts
// (Orçamentos): roda sob demanda, não em background.

import { createServerFn } from "@tanstack/react-start";
import { requireSessionAuth } from "@/lib/session-middleware";
import { z } from "zod";
import { resolveLlmConfig } from "./llm-config";
import { callChatCompletion } from "./providers";
import { fetchCobrancaTitulos } from "./cobranca-data.server";

export interface CobrancaIntervention {
  id: string;
  label: string;
  reason: string;
  priority: "alta" | "media" | "baixa";
}

export interface CobrancaAnalysis {
  summary: string;
  interventions: CobrancaIntervention[];
  metrics: {
    total: number;
    saldoTotal: number;
    atrasoMedio: number;
    acima90dias: number;
  };
  generatedAt: string;
}

const SYSTEM_PROMPT = `Você é um analista de cobrança/financeiro analisando os títulos em aberto da UBVA (controlados pelo agente Diego).

Você recebe um JSON com uma lista "titulos": cada item tem id, numero, cliente, vendedor, status, parcela, diasEmAtraso, valorOriginal, valorJaPago, saldoDevedor.

Sua tarefa:
1. Identificar quais títulos precisam de intervenção humana AGORA — priorize: atraso muito alto (diasEmAtraso grande) especialmente com saldoDevedor alto; título com pagamento parcial estagnado (valorJaPago > 0 mas ainda em aberto há muito tempo); concentração de atraso num mesmo vendedor ou cliente. Não invente motivos genéricos — use os números recebidos.
2. Escrever um resumo curto (3-6 frases, em português brasileiro, direto) com leitura de métricas e tendências: saldo devedor total, distribuição por status, proporção de títulos com atraso severo (>90 dias), concentração por vendedor se relevante.

Responda ESTRITAMENTE em JSON, sem markdown, no formato:
{
  "summary": "string",
  "interventions": [
    { "id": "<id exatamente como recebido>", "label": "<cliente ou nº título>", "reason": "<motivo curto e específico>", "priority": "alta" | "media" | "baixa" }
  ]
}
Se não houver títulos suficientes para uma leitura confiável, devolva "interventions": [] e explique isso no "summary". Nunca invente ids que não estejam nos dados recebidos.`;

function extractJson(s: string): string {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  return start >= 0 && end >= start ? s.slice(start, end + 1) : s;
}

export const analyzeCobrancas = createServerFn({ method: "POST" })
  .middleware([requireSessionAuth])
  .inputValidator((d) => z.object({ accountId: z.string().uuid().optional() }).parse(d))
  .handler(async ({ context }): Promise<CobrancaAnalysis> => {
    // accountId sempre da sessão, nunca do body — ver cobranca.functions.ts.
    if (!context.accountId) throw new Error("Usuário sem conta associada.");
    const accountId = context.accountId;
    const titulos = await fetchCobrancaTitulos(context.userId, accountId);

    const saldoTotal = titulos.reduce((acc, t) => acc + (t.valorDevedorSaldo ?? 0), 0);
    const comAtraso = titulos.filter((t) => t.diasEmAtraso != null);
    const atrasoMedio =
      comAtraso.length > 0
        ? Math.round(comAtraso.reduce((acc, t) => acc + (t.diasEmAtraso ?? 0), 0) / comAtraso.length)
        : 0;
    const acima90dias = titulos.filter((t) => (t.diasEmAtraso ?? 0) > 90).length;

    const metrics = { total: titulos.length, saldoTotal, atrasoMedio, acima90dias };

    if (titulos.length === 0) {
      return {
        summary: "Ainda não há cobranças suficientes para uma análise.",
        interventions: [],
        metrics,
        generatedAt: new Date().toISOString(),
      };
    }

    const llm = await resolveLlmConfig(accountId);

    const payload = {
      titulos: titulos.map((t) => ({
        id: t.id,
        numero: t.numeroTitulo,
        cliente: t.customerName,
        vendedor: t.vendedorNome,
        status: t.statusTitulo,
        parcela: t.parcela,
        diasEmAtraso: t.diasEmAtraso,
        valorOriginal: t.valorOriginalParcela,
        valorJaPago: t.valorJaPago,
        saldoDevedor: t.valorDevedorSaldo,
      })),
    };

    let parsed: { summary?: string; interventions?: CobrancaIntervention[] } = {};
    try {
      const res = await callChatCompletion({
        provider: llm.provider,
        baseUrl: llm.baseUrl,
        apiKey: llm.apiKey,
        model: llm.model,
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(payload) },
        ],
        tools: [],
        jsonMode: true,
      });
      parsed = JSON.parse(extractJson(res.content));
    } catch (err) {
      throw new Error(
        err instanceof Error ? `Falha na análise da IA: ${err.message}` : "Falha na análise da IA",
      );
    }

    const validIds = new Set(titulos.map((t) => t.id));
    const interventions = (Array.isArray(parsed.interventions) ? parsed.interventions : []).filter(
      (i): i is CobrancaIntervention => Boolean(i) && typeof i.id === "string" && validIds.has(i.id),
    );

    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      interventions,
      metrics,
      generatedAt: new Date().toISOString(),
    };
  });

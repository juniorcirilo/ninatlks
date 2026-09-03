// Análise de orçamentos por IA — quais precisam de intervenção e leitura de
// métricas/tendências. Roda sob demanda (botão "Analisar com IA" em
// /orcamentos), não em background: dado que muda pouco entre cliques, gastar
// tokens de LLM automaticamente a cada carga de página seria desperdício.

import { createServerFn } from "@tanstack/react-start";
import { requireSessionAuth } from "@/lib/session-middleware";
import { z } from "zod";
import { resolveLlmConfig } from "./llm-config";
import { callChatCompletion } from "./providers";
import { fetchErpQuotes, fetchChatQuotes } from "./quotes-data.server";

export interface QuoteIntervention {
  id: string;
  source: "erp" | "chat";
  label: string;
  reason: string;
  priority: "alta" | "media" | "baixa";
}

export interface QuotesAnalysis {
  summary: string;
  interventions: QuoteIntervention[];
  metrics: {
    totalErp: number;
    totalErpValue: number;
    totalChat: number;
    totalChatValue: number;
    overdueCount: number;
  };
  generatedAt: string;
}

const DAY_MS = 86_400_000;

const SYSTEM_PROMPT = `Você é um analista de operações comercial analisando os orçamentos de vidros da UBVA (controlados pelo agente Bruno).

Você recebe um JSON com duas listas:
- "erp": orçamentos recebidos via integração com o ERP (numero, cliente, vendedor, status, valor, diasDesdeEmissao, diasAtePrevisao — negativo significa que já passou do prazo previsto).
- "chat": orçamentos calculados e emitidos em conversa pelo Bruno (cliente, projeto, status, total, diasDesdeCriacao).

Sua tarefa:
1. Identificar quais orçamentos precisam de intervenção humana AGORA — priorize: prazo previsto já vencido (diasAtePrevisao < 0) sem status final; parados há muito tempo (diasDesdeEmissao ou diasDesdeCriacao alto) num status intermediário; valor alto parado. Não invente motivos genéricos — use os números recebidos.
2. Escrever um resumo curto (3-6 frases, em português brasileiro, direto) com leitura de métricas e tendências que você conseguir extrair dos dados: totais por status, ticket médio, proporção de orçamentos atrasados, concentração por vendedor se relevante, etc.

Responda ESTRITAMENTE em JSON, sem markdown, no formato:
{
  "summary": "string",
  "interventions": [
    { "id": "<contactId ou quoteId exatamente como recebido>", "source": "erp" | "chat", "label": "<cliente ou nº orçamento>", "reason": "<motivo curto e específico>", "priority": "alta" | "media" | "baixa" }
  ]
}
Se não houver orçamentos suficientes para uma leitura confiável, devolva "interventions": [] e explique isso no "summary". Nunca invente ids que não estejam nos dados recebidos.`;

function extractJson(s: string): string {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  return start >= 0 && end >= start ? s.slice(start, end + 1) : s;
}

export const analyzeQuotes = createServerFn({ method: "POST" })
  .middleware([requireSessionAuth])
  .inputValidator((d) => z.object({ accountId: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<QuotesAnalysis> => {
    const [erp, chat] = await Promise.all([
      fetchErpQuotes(data.accountId),
      fetchChatQuotes(data.accountId),
    ]);

    const now = Date.now();
    const erpEnriched = erp.map((q) => ({
      ...q,
      diasDesdeEmissao: q.dataEmissao ? Math.floor((now - new Date(q.dataEmissao).getTime()) / DAY_MS) : null,
      diasAtePrevisao: q.dataPrevisao ? Math.floor((new Date(q.dataPrevisao).getTime() - now) / DAY_MS) : null,
    }));
    const overdueCount = erpEnriched.filter((q) => q.diasAtePrevisao != null && q.diasAtePrevisao < 0).length;

    const metrics = {
      totalErp: erp.length,
      totalErpValue: erp.reduce((acc, q) => acc + (q.valorTotal ?? 0), 0),
      totalChat: chat.length,
      totalChatValue: chat.reduce((acc, q) => acc + q.total, 0),
      overdueCount,
    };

    if (erp.length === 0 && chat.length === 0) {
      return {
        summary: "Ainda não há orçamentos suficientes para uma análise.",
        interventions: [],
        metrics,
        generatedAt: new Date().toISOString(),
      };
    }

    const llm = await resolveLlmConfig(data.accountId);

    const payload = {
      erp: erpEnriched.map((q) => ({
        id: q.contactId,
        numero: q.numeroOrcamento,
        cliente: q.customerName,
        vendedor: q.vendedorNome,
        status: q.statusOrcamento,
        valor: q.valorTotal,
        diasDesdeEmissao: q.diasDesdeEmissao,
        diasAtePrevisao: q.diasAtePrevisao,
      })),
      chat: chat.map((q) => ({
        id: q.id,
        cliente: q.customerName,
        projeto: q.projectDescription,
        status: q.status,
        total: q.total,
        diasDesdeCriacao: Math.floor((now - new Date(q.createdAt).getTime()) / DAY_MS),
      })),
    };

    let parsed: { summary?: string; interventions?: QuoteIntervention[] } = {};
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

    const validIds = new Set([...erp.map((q) => q.contactId), ...chat.map((q) => q.id)]);
    const interventions = (Array.isArray(parsed.interventions) ? parsed.interventions : []).filter(
      (i): i is QuoteIntervention =>
        Boolean(i) && typeof i.id === "string" && validIds.has(i.id) && (i.source === "erp" || i.source === "chat"),
    );

    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      interventions,
      metrics,
      generatedAt: new Date().toISOString(),
    };
  });

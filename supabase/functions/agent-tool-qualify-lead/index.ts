// deno-lint-ignore-file no-explicit-any
//
// agent-tool-qualify-lead
// -----------------------
// Tool webhook chamada pelo agente ElevenLabs DURANTE a chamada quando
// o agente SDR consegue qualificar o lead (BANT-leve: nome, contato, dor,
// fit, próxima ação). Cria/atualiza o contact no pipeline ANTES da
// finalização pós-call, com confiança alta — espelho do
// arrangement-from-agent-tool do CobrAI.
//
// Auth: header x-el-webhook-secret = ELEVENLABS_WEBHOOK_SECRET.
// IDs viajam por header (x-conversation-id) porque o LLM não memoriza UUIDs.
//
// Body (do agent):
// {
//   nome?, telefone?, email?, cidade?, uf?, empresa?, cnpj?,
//   dor_principal?, ferramenta_atual?,
//   interesse: "alto"|"medio"|"baixo"|"descartado",
//   fase_pipeline: "novo_lead"|"qualificado"|"demo_agendada"|"proposta"|"descartado",
//   sentimento: "positivo"|"neutro"|"negativo",
//   temperatura?: "quente"|"morno"|"frio",
//   motivo_descarte?: "sem_fit"|"sem_orcamento"|"concorrente"|"dnc"|"outro",
//   proxima_acao?: "agendar_demo"|"enviar_material"|"recontato"|"nenhuma",
//   observacao?: string
// }
//
// Comportamento:
//   1. Resolve account_id + voice_call via header x-conversation-id.
//   2. Resolve/cria contact (mesma lógica do lead-classify-from-call).
//   3. Mapeia fase_pipeline → outcome_category → stage_name → stage_id.
//   4. Calcula score = base do stage + boost de temperatura.
//   5. Atualiza contacts (nome, email, score, briefing, stage, sentiment).
//   6. Atualiza voice_calls (outcome_category, classification.source='agent_tool').
//   7. Insere conversation_outcomes (se houver conversation_id).
//   8. Se motivo_descarte=dnc → adiciona em dnc_list.
//
// Retorno: { ok, contact_id, mensagem_confirmacao } pro agente confirmar
// verbalmente ao lead.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import {
  FASE_TO_CATEGORY,
  STAGE_BY_CATEGORY,
  TEMPERATURE_BOOST,
  resolveContactIdFromCall,
  resolveStageIdByName,
} from "../_shared/leads/resolve.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-el-webhook-secret, x-conversation-id, x-agent-id, x-caller-phone",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ ok: false, error: "method not allowed" }, 405);

  // ── Auth ─────────────────────────────────────────────────
  const expected = Deno.env.get("ELEVENLABS_WEBHOOK_SECRET") ?? "";
  const received = req.headers.get("x-el-webhook-secret") ?? "";
  if (!expected || expected !== received) {
    return j({ ok: false, error: "unauthorized" }, 401);
  }

  // ── Parse body ───────────────────────────────────────────
  let body: any;
  try { body = await req.json(); }
  catch { return j({ ok: false, error: "invalid json" }, 400); }

  // conversation_id pode vir do header (preferido) ou do body (fallback se EL
  // não suportar dynamic_variables nesta tool).
  const conversationId =
    req.headers.get("x-conversation-id") ||
    (typeof body.conversation_id === "string" ? body.conversation_id : null);

  if (!conversationId) {
    return j({ ok: false, error: "x-conversation-id header or conversation_id required" }, 400);
  }

  const fasePipeline: string = String(body.fase_pipeline ?? "").trim();
  const sentimento: string = String(body.sentimento ?? "").trim();
  if (!fasePipeline || !sentimento) {
    return j({ ok: false, error: "fase_pipeline and sentimento are required" }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── 1. Resolve voice_call pelo source_id (EL conversation_id) ──
  const { data: call, error: callErr } = await admin
    .from("voice_calls")
    .select("id, account_id, conversation_id, from_number, to_number, direction, metadata, classification")
    .eq("source_id", conversationId)
    .maybeSingle();

  if (callErr || !call) {
    console.warn(`[qualify-lead] voice_call não encontrada p/ conversation_id=${conversationId}`);
    return j({ ok: false, error: "call context not found" }, 404);
  }

  // ── 2. Resolve/cria contact ──────────────────────────────
  const contactId = await resolveContactIdFromCall(admin, call as any);
  if (!contactId) {
    return j({ ok: false, error: "could not resolve contact" }, 500);
  }

  // ── 3. Mapeia fase_pipeline → outcome_category → stage ───
  const category = FASE_TO_CATEGORY[fasePipeline] ?? "other";
  const stageInfo = STAGE_BY_CATEGORY[category];
  const stageId = await resolveStageIdByName(admin, (call as any).account_id, stageInfo.stageName);

  // ── 4. Score com boost de temperatura ────────────────────
  const tempBoost = TEMPERATURE_BOOST[String(body.temperatura ?? "")] ?? 0;
  const score = clamp(stageInfo.score + tempBoost, 0, 100);

  // ── 5. Briefing estruturado ──────────────────────────────
  const briefing = {
    dor: stringOrNull(body.dor_principal),
    fit: composeFit(body),
    objections: [] as string[],
    next_action: stringOrNull(body.proxima_acao) ?? stringOrNull(body.observacao),
  };

  // ── 6. Update contact (merge — só sobrescreve se valor veio) ──
  const contactUpdates: Record<string, any> = {
    score,
    briefing,
    last_sentiment: sentimento,
    last_activity_at: new Date().toISOString(),
  };
  if (stageId) contactUpdates.stage_id = stageId;
  if (stringOrNull(body.nome)) contactUpdates.name = String(body.nome).trim().slice(0, 200);
  if (stringOrNull(body.email)) contactUpdates.email = String(body.email).trim().toLowerCase().slice(0, 200);
  if (stringOrNull(body.telefone)) contactUpdates.phone_number = String(body.telefone).trim().slice(0, 32);
  if (stringOrNull(body.cidade) || stringOrNull(body.uf)) {
    const cidade = stringOrNull(body.cidade) ?? "";
    const uf = stringOrNull(body.uf) ?? "";
    contactUpdates.location = [cidade, uf].filter(Boolean).join("/").slice(0, 200);
  }
  // Empresa/CNPJ ficam em custom_attributes (não há colunas dedicadas).
  const customExtras: Record<string, any> = {};
  if (stringOrNull(body.empresa)) customExtras.empresa = String(body.empresa).trim().slice(0, 200);
  if (stringOrNull(body.cnpj)) customExtras.cnpj = String(body.cnpj).replace(/\D/g, "").slice(0, 14);
  if (stringOrNull(body.ferramenta_atual)) customExtras.ferramenta_atual = String(body.ferramenta_atual).trim().slice(0, 200);

  if (Object.keys(customExtras).length > 0) {
    // merge em custom_attributes — preserva o que já existe
    const { data: existing } = await admin
      .from("contacts")
      .select("custom_attributes")
      .eq("id", contactId)
      .maybeSingle();
    contactUpdates.custom_attributes = {
      ...((existing?.custom_attributes as any) ?? {}),
      ...customExtras,
    };
  }

  const { error: updContactErr } = await admin
    .from("contacts")
    .update(contactUpdates)
    .eq("id", contactId);
  if (updContactErr) {
    console.error("[qualify-lead] contact update failed", updContactErr);
    return j({ ok: false, error: "contact update failed" }, 500);
  }

  // ── 7. Update voice_calls com flag source=agent_tool ─────
  const classification = {
    source: "agent_tool" as const,
    category,
    fase_pipeline: fasePipeline,
    interesse: stringOrNull(body.interesse),
    sentimento,
    temperatura: stringOrNull(body.temperatura),
    motivo_descarte: stringOrNull(body.motivo_descarte),
    proxima_acao: stringOrNull(body.proxima_acao),
    score,
    briefing,
    classified_at: new Date().toISOString(),
  };

  await admin.from("voice_calls").update({
    outcome_category: category,
    outcome_confidence: 0.95, // alto — veio direto do LLM ao vivo
    outcome_summary: composeSummary(body, briefing),
    outcome_classified_at: new Date().toISOString(),
    classification: classification as any,
  }).eq("id", (call as any).id);

  // ── 8. conversation_outcomes (se houver conversa) ────────
  if ((call as any).conversation_id) {
    await admin.from("conversation_outcomes").insert({
      account_id: (call as any).account_id,
      conversation_id: (call as any).conversation_id,
      contact_id: contactId,
      outcome_type: category,
      confidence: 0.95,
      source: "agent-tool-qualify-lead",
      metadata: { score, fase_pipeline: fasePipeline, sentimento } as any,
    });
  }

  // ── 9. DNC se motivo=dnc ─────────────────────────────────
  if (body.motivo_descarte === "dnc" && stringOrNull(body.telefone)) {
    await admin.from("dnc_list").insert({
      account_id: (call as any).account_id,
      phone_number: String(body.telefone).trim(),
      reason: "agent_dnc_request",
      source: "agent-tool-qualify-lead",
      notes: stringOrNull(body.observacao),
    }).select().maybeSingle();
  }

  console.log(
    `[qualify-lead] call=${(call as any).id} contact=${contactId} fase=${fasePipeline} cat=${category} score=${score} stage=${stageId ?? "—"}`,
  );

  // Mensagem curta pro agente confirmar verbalmente. PT-BR.
  const firstName = stringOrNull(body.nome)
    ? String(body.nome).trim().split(/\s+/)[0]
    : "";
  const mensagem = firstName
    ? `Anotei aqui, ${firstName}. Vamos seguir.`
    : "Anotado. Vamos seguir.";

  return j({
    ok: true,
    contact_id: contactId,
    fase_pipeline: fasePipeline,
    score,
    confirmation_message: mensagem,
  });
});

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function stringOrNull(v: any): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 && s.toLowerCase() !== "null" ? s : null;
}

function composeFit(body: any): string | null {
  const parts: string[] = [];
  const interesse = stringOrNull(body.interesse);
  const temperatura = stringOrNull(body.temperatura);
  const empresa = stringOrNull(body.empresa);
  if (interesse) parts.push(`interesse=${interesse}`);
  if (temperatura) parts.push(`temperatura=${temperatura}`);
  if (empresa) parts.push(`empresa=${empresa}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function composeSummary(body: any, briefing: { dor: string | null; next_action: string | null }): string {
  const parts: string[] = [];
  if (briefing.dor) parts.push(`Dor: ${briefing.dor}`);
  if (briefing.next_action) parts.push(`Próximo passo: ${briefing.next_action}`);
  if (stringOrNull(body.observacao)) parts.push(String(body.observacao).trim());
  return parts.join(" · ").slice(0, 500) || "Lead qualificado pelo agente";
}

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

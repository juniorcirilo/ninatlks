// deno-lint-ignore-file no-explicit-any
//
// sentiment-analyze
// -----------------
// Pós-call: analisa sentimento da transcrição e grava em
// voice_calls.sentiment como JSONB:
//   {
//     aggregate: "positive" | "neutral" | "negative",
//     score: -1..1,
//     positivity: 0..1,
//     turn_count: number,
//     analyzed_at: ISO,
//     per_turn: [{ index, role, sentiment, score }]
//   }
//
// Usa Lovable AI Gateway com gemini-flash-lite (cheap). Heurística
// simples (lexicon) como fallback.
//
// Body: { voice_call_id }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Sentiment = "positive" | "neutral" | "negative";

interface PerTurn {
  index: number;
  role: string;
  sentiment: Sentiment;
  score: number;
}

interface SentimentReport {
  aggregate: Sentiment;
  score: number;        // -1..1 (média ponderada por role do lead)
  positivity: number;   // 0..1
  turn_count: number;
  analyzed_at: string;
  per_turn: PerTurn[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ ok: false, error: "method not allowed" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: { voice_call_id?: string };
  try { body = await req.json(); }
  catch { return j({ ok: false, error: "invalid json" }, 400); }

  if (!body.voice_call_id) return j({ ok: false, error: "voice_call_id required" }, 400);

  const { data: call, error: callErr } = await admin
    .from("voice_calls")
    .select("id, account_id, conversation_id, from_number, to_number, direction, transcript, metadata")
    .eq("id", body.voice_call_id)
    .maybeSingle();
  if (callErr || !call) return j({ ok: false, error: "voice_call not found" }, 404);

  const turns = extractTurns((call as any).transcript);
  if (turns.length === 0) {
    return j({ ok: false, error: "no transcript turns to analyze" }, 400);
  }

  const report = await analyze(turns);

  await admin.from("voice_calls")
    .update({ sentiment: report as any })
    .eq("id", (call as any).id);

  // Mirror no contato + regra de auto-movimentação por sentimento
  let autoMove: { from_stage: string | null; to_stage: string | null; contact_id: string | null } = {
    from_stage: null, to_stage: null, contact_id: null,
  };
  try {
    autoMove = await applySentimentToContact(admin, call as any, report);
  } catch (e) {
    console.warn("[sentiment-analyze] applySentimentToContact failed", e);
  }

  console.log(
    `[sentiment-analyze] call=${(call as any).id} aggregate=${report.aggregate} score=${report.score.toFixed(2)} turns=${report.turn_count} auto_move=${autoMove.from_stage ?? "—"}→${autoMove.to_stage ?? "—"}`,
  );

  return j({ ok: true, voice_call_id: (call as any).id, sentiment: report, auto_move: autoMove });
});

/**
 * Reflete o sentimento no contato e, se a regra disparar, move-o para outro
 * stage. Roda DEPOIS do lead-classify-from-call (paralelos no voice-call-finalize),
 * então normalmente o stage_id já está setado.
 *
 * Regras:
 *  - sentimento "negative" + score < -0.4 + stage atual NÃO won/lost → move p/ "Perdeu"
 *  - sentimento "positive" + score > 0.5 + stage atual em [Novo, Contatado] → promove p/ "Qualificado"
 */
async function applySentimentToContact(
  admin: any,
  call: any,
  report: SentimentReport,
): Promise<{ from_stage: string | null; to_stage: string | null; contact_id: string | null }> {
  const contactId = await resolveContactId(admin, call);
  if (!contactId) return { from_stage: null, to_stage: null, contact_id: null };

  // Update mirror fields
  const baseUpdate: Record<string, any> = {
    last_sentiment: report.aggregate,
    last_sentiment_score: report.score,
  };

  // Carrega contato atual + stage
  const { data: contact } = await admin
    .from("contacts")
    .select("id, stage_id, account_id")
    .eq("id", contactId)
    .maybeSingle();
  if (!contact) {
    await admin.from("contacts").update(baseUpdate).eq("id", contactId);
    return { from_stage: null, to_stage: null, contact_id: contactId };
  }

  let targetStageName: string | null = null;
  if (report.aggregate === "negative" && report.score < -0.4) {
    targetStageName = "Perdeu";
  } else if (report.aggregate === "positive" && report.score > 0.5) {
    // Só promove se atual for "Novo" ou "Contatado"
    if (contact.stage_id) {
      const { data: currentStage } = await admin
        .from("lead_stages")
        .select("name, is_won, is_lost")
        .eq("id", contact.stage_id)
        .maybeSingle();
      if (currentStage && !currentStage.is_won && !currentStage.is_lost) {
        const n = String(currentStage.name).toLowerCase();
        if (n.includes("novo") || n.includes("contatado")) targetStageName = "Qualificado";
      }
    }
  }

  if (!targetStageName) {
    await admin.from("contacts").update(baseUpdate).eq("id", contactId);
    return { from_stage: contact.stage_id, to_stage: null, contact_id: contactId };
  }

  // Não mover se já estiver em won/lost
  if (contact.stage_id) {
    const { data: cs } = await admin
      .from("lead_stages")
      .select("is_won, is_lost")
      .eq("id", contact.stage_id)
      .maybeSingle();
    if (cs && (cs.is_won || cs.is_lost)) {
      await admin.from("contacts").update(baseUpdate).eq("id", contactId);
      return { from_stage: contact.stage_id, to_stage: null, contact_id: contactId };
    }
  }

  // Resolve stage destino dentro do pipeline default da account
  const { data: pipeline } = await admin
    .from("lead_pipelines")
    .select("id")
    .eq("account_id", contact.account_id)
    .eq("is_default", true)
    .maybeSingle();
  if (!pipeline) {
    await admin.from("contacts").update(baseUpdate).eq("id", contactId);
    return { from_stage: contact.stage_id, to_stage: null, contact_id: contactId };
  }

  const { data: targetStage } = await admin
    .from("lead_stages")
    .select("id")
    .eq("pipeline_id", pipeline.id)
    .ilike("name", targetStageName)
    .maybeSingle();
  if (!targetStage || targetStage.id === contact.stage_id) {
    await admin.from("contacts").update(baseUpdate).eq("id", contactId);
    return { from_stage: contact.stage_id, to_stage: null, contact_id: contactId };
  }

  await admin.from("contacts").update({
    ...baseUpdate,
    stage_id: targetStage.id,
    stage_changed_at: new Date().toISOString(),
    auto_moved_at: new Date().toISOString(),
  }).eq("id", contactId);

  // Log auditoria
  if (call.conversation_id) {
    await admin.from("conversation_outcomes").insert({
      account_id: call.account_id,
      conversation_id: call.conversation_id,
      contact_id: contactId,
      outcome_type: "sentiment_auto_move",
      confidence: Math.abs(report.score),
      source: "sentiment-analyze",
      metadata: {
        from_stage_id: contact.stage_id,
        to_stage_id: targetStage.id,
        to_stage_name: targetStageName,
        sentiment: report.aggregate,
        sentiment_score: report.score,
      } as any,
    });
  }

  return { from_stage: contact.stage_id, to_stage: targetStage.id, contact_id: contactId };
}

async function resolveContactId(admin: any, call: any): Promise<string | null> {
  const metaContactId = call?.metadata?.contact_id;
  if (typeof metaContactId === "string" && metaContactId) return metaContactId;

  if (call.conversation_id) {
    const { data: conv } = await admin
      .from("conversations")
      .select("contact_id")
      .eq("id", call.conversation_id)
      .maybeSingle();
    if (conv?.contact_id) return conv.contact_id;
  }

  const leadPhone = call.direction === "outbound" ? call.to_number : call.from_number;
  if (leadPhone) {
    const { data: existing } = await admin
      .from("contacts")
      .select("id")
      .eq("account_id", call.account_id)
      .eq("phone_number", leadPhone)
      .maybeSingle();
    if (existing?.id) return existing.id;
  }
  return null;
}

function extractTurns(transcript: any): { role: string; text: string }[] {
  if (!transcript) return [];
  if (typeof transcript === "string") {
    return transcript
      .split(/\n+/)
      .map((line, i) => ({ role: i % 2 === 0 ? "agent" : "user", text: line.trim() }))
      .filter((t) => t.text.length > 0);
  }
  if (Array.isArray(transcript)) {
    return transcript
      .map((t: any) => ({
        role: String(t.role ?? t.speaker ?? "user").toLowerCase(),
        text: String(t.content ?? t.message ?? t.text ?? "").trim(),
      }))
      .filter((t) => t.text.length > 0);
  }
  return [];
}

async function analyze(turns: { role: string; text: string }[]): Promise<SentimentReport> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");

  let perTurn: PerTurn[];
  if (apiKey) {
    try {
      perTurn = await analyzeWithLLM(apiKey, turns);
    } catch (e) {
      console.warn("[sentiment-analyze] LLM failed, falling back to lexicon", e);
      perTurn = analyzeWithLexicon(turns);
    }
  } else {
    perTurn = analyzeWithLexicon(turns);
  }

  // Aggregate: ponderado pelos turnos do user/lead (não do agent), porque
  // queremos saber como o LEAD se sentiu. Se não houver turn de user, usa todos.
  const userTurns = perTurn.filter(t => t.role === "user" || t.role === "human" || t.role === "lead");
  const sample = userTurns.length > 0 ? userTurns : perTurn;
  const avgScore = sample.reduce((s, t) => s + t.score, 0) / sample.length;
  const aggregate: Sentiment = avgScore > 0.15 ? "positive" : avgScore < -0.15 ? "negative" : "neutral";
  const positivity = (avgScore + 1) / 2;

  return {
    aggregate,
    score: Number(avgScore.toFixed(3)),
    positivity: Number(positivity.toFixed(3)),
    turn_count: perTurn.length,
    analyzed_at: new Date().toISOString(),
    per_turn: perTurn,
  };
}

async function analyzeWithLLM(apiKey: string, turns: { role: string; text: string }[]): Promise<PerTurn[]> {
  // Limitamos a 60 turnos pra controlar tokens. Calls maiores que isso são raras.
  const sample = turns.slice(0, 60);
  const numbered = sample
    .map((t, i) => `[${i}] (${t.role}) ${t.text.slice(0, 280)}`)
    .join("\n");

  const prompt = `Para cada turno abaixo, classifique o sentimento em "positive", "neutral" ou "negative" com um score de -1 a 1. Devolva APENAS JSON válido.

Turnos:
${numbered}

Formato:
{
  "turns": [
    {"index": 0, "sentiment": "neutral", "score": 0.0},
    ...
  ]
}`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content);
  const arr = Array.isArray(parsed.turns) ? parsed.turns : [];

  const out: PerTurn[] = sample.map((t, i) => {
    const found = arr.find((x: any) => x.index === i);
    const sent: Sentiment = found?.sentiment === "positive" || found?.sentiment === "negative" || found?.sentiment === "neutral"
      ? found.sentiment
      : "neutral";
    const score = typeof found?.score === "number" ? clamp(found.score, -1, 1) : 0;
    return { index: i, role: t.role, sentiment: sent, score };
  });
  return out;
}

const POS = [
  "ótimo","otimo","excelente","bom","perfeito","interessante","gostei","quero","topo","topei","fechado","fechamos",
  "obrigad","valeu","amei","incrível","incrivel","sensacional","claro","sim","com certeza","de acordo",
];
const NEG = [
  "ruim","péssimo","pessimo","odeio","detesto","caro","caríssimo","carissimo","não quero","nao quero","sem interesse",
  "não preciso","nao preciso","irritado","chato","problema","reclamação","reclamacao","decepc","horrível","horrivel",
  "para de","pare de","não me lig","nao me lig","tira da lista",
];

function analyzeWithLexicon(turns: { role: string; text: string }[]): PerTurn[] {
  return turns.map((t, i) => {
    const text = t.text.toLowerCase();
    let score = 0;
    for (const w of POS) if (text.includes(w)) score += 0.4;
    for (const w of NEG) if (text.includes(w)) score -= 0.4;
    score = clamp(score, -1, 1);
    const sentiment: Sentiment = score > 0.15 ? "positive" : score < -0.15 ? "negative" : "neutral";
    return { index: i, role: t.role, sentiment, score: Number(score.toFixed(2)) };
  });
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

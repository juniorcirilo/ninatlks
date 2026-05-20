// deno-lint-ignore-file no-explicit-any
// call-summary-generate
// ---------------------
// Gera resumo IA pós-call (Lovable AI) e grava em voice_calls.ai_summary.
// Body: { voice_call_id: uuid, force?: boolean }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ ok: false, error: "method not allowed" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: { voice_call_id?: string; force?: boolean };
  try { body = await req.json(); } catch { return j({ ok: false, error: "invalid json" }, 400); }
  if (!body.voice_call_id) return j({ ok: false, error: "voice_call_id required" }, 400);

  const { data: call } = await admin
    .from("voice_calls")
    .select("id, transcript, metadata, ai_summary, duration_seconds, outcome_category, outcome_summary")
    .eq("id", body.voice_call_id)
    .maybeSingle();
  if (!call) return j({ ok: false, error: "voice_call not found" }, 404);

  if ((call as any).ai_summary && !body.force) {
    return j({ ok: true, voice_call_id: (call as any).id, skipped: true, ai_summary: (call as any).ai_summary });
  }

  const transcriptText = extractTranscriptText((call as any).transcript);
  if (!transcriptText) return j({ ok: false, error: "no transcript" }, 400);

  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return j({ ok: false, error: "LOVABLE_API_KEY missing" }, 500);

  const kind = ((call as any).metadata as any)?.campaign_kind ?? "sdr";
  const sample = transcriptText.slice(0, 6000);

  const prompt = `Você é um analista de operações de IA. Analise a transcrição abaixo de uma ligação de tipo "${kind}" e gere um RESUMO EXECUTIVO em PT-BR.

Formato OBRIGATÓRIO (markdown):
**Resultado:** <1 linha>
**Pontos-chave:**
- <ponto 1>
- <ponto 2>
- <ponto 3>
**Próxima ação:** <recomendação concreta, 1 linha>

Máximo 600 caracteres no total. Seja específico e objetivo.

Transcrição:
${sample}`;

  let summary = "";
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      console.error("[call-summary] LLM failed", res.status, txt.slice(0, 200));
      return j({ ok: false, error: `LLM ${res.status}` }, 502);
    }
    const data = await res.json();
    summary = (data.choices?.[0]?.message?.content ?? "").trim().slice(0, 1200);
  } catch (e) {
    console.error("[call-summary] LLM exception", e);
    return j({ ok: false, error: "LLM exception" }, 500);
  }

  if (!summary) return j({ ok: false, error: "empty summary" }, 500);

  await admin.from("voice_calls").update({ ai_summary: summary }).eq("id", (call as any).id);

  return j({ ok: true, voice_call_id: (call as any).id, ai_summary: summary });
});

function extractTranscriptText(transcript: any): string {
  if (!transcript) return "";
  if (typeof transcript === "string") return transcript;
  if (Array.isArray(transcript)) {
    return transcript.map((t: any) => {
      const role = t.role ?? t.speaker ?? "";
      const content = t.content ?? t.message ?? t.text ?? "";
      return `${role}: ${content}`;
    }).filter(Boolean).join("\n");
  }
  return "";
}

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

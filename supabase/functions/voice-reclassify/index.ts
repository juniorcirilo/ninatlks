// Re-run outcome classification on a single voice_call.
// Auth: requires JWT + admin role on the call's account.
// Input: { voice_call_id }
//
// Reads transcript+summary from the DB (never trusts client-supplied text),
// runs the same heuristic+AI classifier as elevenlabs-events, and updates
// the row. Also handles auto-DNC if reclassified to do_not_call.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_CATEGORIES = [
  "interested",
  "not_interested",
  "callback_requested",
  "voicemail",
  "wrong_number",
  "do_not_call",
  "no_answer",
  "busy",
  "failed",
  "escalated",
  "other",
] as const;
type OutcomeCategory = (typeof ALLOWED_CATEGORIES)[number];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ ok: false, error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return j({ ok: false, error: "unauthorized" }, 401);

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
    .select("id, account_id, to_number, transcript, metadata")
    .eq("id", body.voice_call_id)
    .maybeSingle();
  if (callErr || !call) return j({ ok: false, error: "call not found" }, 404);

  // Verify admin role on the account
  const { data: role } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("account_id", (call as any).account_id)
    .maybeSingle();
  if (!role || (role as any).role !== "admin") {
    return j({ ok: false, error: "forbidden" }, 403);
  }

  const transcript = (call as any).transcript;
  const summary = ((call as any).metadata as any)?.summary ?? null;
  const transcriptText = extractTranscriptText(transcript);

  if (!transcriptText && !summary) {
    return j({ ok: false, error: "no transcript or summary to classify" }, 400);
  }

  try {
    const classification = await classifyOutcome(transcriptText, summary);
    await admin.from("voice_calls").update({
      outcome_category: classification.category,
      outcome_confidence: classification.confidence,
      outcome_summary: classification.summary,
      outcome_classified_at: new Date().toISOString(),
    }).eq("id", (call as any).id);

    if (classification.category === "do_not_call" && (call as any).to_number) {
      await admin.from("dnc_list").upsert(
        {
          account_id: (call as any).account_id,
          phone_number: (call as any).to_number,
          source: "ai_classified",
          reason: classification.summary,
          notes: `manual reclassification of voice_call ${(call as any).id}`,
          added_by: user.id,
        } as any,
        { onConflict: "account_id,phone_number", ignoreDuplicates: true },
      );
    }

    return j({ ok: true, classification });
  } catch (e: any) {
    console.error("[voice-reclassify] failed", e);
    return j({ ok: false, error: e?.message ?? "classification failed" }, 500);
  }
});

function extractTranscriptText(transcript: any): string {
  if (!transcript) return "";
  if (typeof transcript === "string") return transcript;
  if (Array.isArray(transcript)) {
    return transcript
      .map((t: any) => {
        const role = t.role ?? t.speaker ?? "";
        const content = t.content ?? t.message ?? t.text ?? "";
        return `${role}: ${content}`;
      })
      .join("\n");
  }
  return "";
}

interface Classification {
  category: OutcomeCategory;
  confidence: number;
  summary: string;
}

async function classifyOutcome(transcriptText: string, summary: string | null): Promise<Classification> {
  const text = (transcriptText + "\n" + (summary ?? "")).toLowerCase();

  const heuristics: Array<{ category: OutcomeCategory; patterns: RegExp[] }> = [
    {
      category: "do_not_call",
      patterns: [
        /n[aã]o me lig[ua]/, /para de me lig/, /pare de lig/, /n[aã]o quero mais receber/,
        /n[aã]o ligue mais/, /me tira da lista/, /remover da lista/, /n[aã]o me incomod/,
      ],
    },
    {
      category: "wrong_number",
      patterns: [/n[uú]mero errado/, /n[aã]o conhe[çc]o/, /pessoa errada/, /n[aã]o [eé] essa pessoa/],
    },
    {
      category: "callback_requested",
      patterns: [/me lig[ua] (depois|mais tarde|amanh[aã])/, /retorn[ae] (depois|mais tarde)/, /agora n[aã]o posso/, /estou ocupad/, /pode ligar (depois|amanh[aã])/],
    },
    {
      category: "not_interested",
      patterns: [/n[aã]o tenho interesse/, /n[aã]o me interessa/, /n[aã]o quero/, /n[aã]o preciso/, /sem interesse/],
    },
    {
      category: "interested",
      patterns: [/tenho interesse/, /quero (saber mais|comprar|contratar|conhecer)/, /me manda (mais|por whatsapp)/, /pode mandar/, /vou querer/, /fech[ao]u/, /aceito/],
    },
    {
      category: "voicemail",
      patterns: [/deixe (sua|uma) mensagem/, /caixa postal/, /ap[óo]s o sinal/],
    },
  ];

  for (const h of heuristics) {
    for (const p of h.patterns) {
      if (p.test(text)) {
        return {
          category: h.category,
          confidence: 0.95,
          summary: extractSummaryFromText(text, 120),
        };
      }
    }
  }

  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    return { category: "other", confidence: 0.3, summary: summary ?? "" };
  }

  const sample = (transcriptText || summary || "").slice(0, 2000);
  const prompt = `Classifique o resultado desta ligação telefônica em UMA categoria. Responda APENAS JSON válido sem markdown.

Categorias permitidas:
- interested, not_interested, callback_requested, voicemail, wrong_number, do_not_call, no_answer, busy, failed, escalated, other

Transcript:
${sample}

Responda EXATAMENTE neste formato JSON:
{"category":"<uma das categorias>","confidence":<0..1>,"summary":"<1 frase em PT-BR>"}`;

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      return { category: "other", confidence: 0.3, summary: summary ?? "" };
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content);
    const category = ALLOWED_CATEGORIES.includes(parsed.category) ? parsed.category : "other";
    return {
      category,
      confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
      summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 280) : (summary ?? ""),
    };
  } catch (e) {
    console.error("[voice-reclassify] AI classify exception", e);
    return { category: "other", confidence: 0.3, summary: summary ?? "" };
  }
}

function extractSummaryFromText(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

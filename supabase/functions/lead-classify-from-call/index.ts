// deno-lint-ignore-file no-explicit-any
//
// lead-classify-from-call
// -----------------------
// Pós-call do SDR: lê transcript+summary do voice_call, classifica o
// outcome via heurística + LLM (Lovable AI Gateway), e:
//   1. Liga o contato (lookup por conversation_id ou from_number, ou cria).
//   2. Atualiza contacts.stage_id + score + briefing + source.
//   3. Atualiza voice_calls.outcome_* + classification.
//   4. Insere em conversation_outcomes (se houver conversation_id).
//
// Body: { voice_call_id: uuid }
// Retorno: { ok, contact_id, stage_id, classification }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Catálogo padrão SDR (fallback se nenhuma linha no call_outcomes_catalog).
// Quando a call vem de uma campanha, lemos o catálogo dinâmico por
// campaign_kind. Para tudo fora desse universo (SDR clássico), usamos
// estes defaults.
const DEFAULT_SDR_CATEGORIES = [
  "scheduled","qualified","not_interested","callback","no_answer",
  "voicemail","wrong_number","escalated","other",
] as const;
type OutcomeCategory = string;

// Score sugerido base por outcome (sobrescrito pelo catálogo quando existe).
const DEFAULT_SDR_SCORE: Record<string, { stageName: string; score: number }> = {
  scheduled:      { stageName: "Reunião agendada", score: 95 },
  qualified:      { stageName: "Qualificado",      score: 70 },
  callback:       { stageName: "Contatado",        score: 50 },
  escalated:      { stageName: "Qualificado",      score: 60 },
  no_answer:      { stageName: "Contatado",        score: 20 },
  voicemail:      { stageName: "Contatado",        score: 15 },
  not_interested: { stageName: "Perdeu",           score: 5 },
  wrong_number:   { stageName: "Perdeu",           score: 0 },
  other:          { stageName: "Contatado",        score: 30 },
};

interface Briefing {
  dor: string | null;
  fit: string | null;
  objections: string[];
  next_action: string | null;
}

interface Classification {
  category: OutcomeCategory;
  confidence: number;
  score: number;
  summary: string;
  briefing: Briefing;
  contact_name: string | null;
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

  // 1. Buscar a call
  const { data: call, error: callErr } = await admin
    .from("voice_calls")
    .select("id, account_id, conversation_id, from_number, to_number, transcript, metadata, direction, classification, outcome_category")
    .eq("id", body.voice_call_id)
    .maybeSingle();
  if (callErr || !call) return j({ ok: false, error: "voice_call not found" }, 404);

  // Gate: se a tool em tempo real (agent-tool-qualify-lead) já classificou,
  // não sobrescreve. O lead ao vivo ganha do fallback de transcrição —
  // mesmo padrão do CobrAI (source='agent_tool' tem prioridade absoluta).
  const existingClassification = (call as any).classification;
  if (
    existingClassification &&
    typeof existingClassification === "object" &&
    existingClassification.source === "agent_tool"
  ) {
    console.log(
      `[lead-classify] skip — call=${(call as any).id} já classificada via agent_tool`,
    );
    return j({
      ok: true,
      voice_call_id: (call as any).id,
      skipped: true,
      reason: "already classified by agent_tool",
      classification: existingClassification,
    });
  }

  const transcript = (call as any).transcript;
  const summary = ((call as any).metadata as any)?.summary ?? null;
  const transcriptText = extractTranscriptText(transcript);

  if (!transcriptText && !summary) {
    return j({ ok: false, error: "no transcript or summary to classify" }, 400);
  }

  // 2. Resolver campaign_kind a partir do metadata da call
  const campaignKind = ((call as any).metadata as any)?.campaign_kind ?? "sdr";

  // 3. Carregar catálogo de outcomes para esse kind (account override OU global)
  const catalog = await loadOutcomesCatalog(admin, (call as any).account_id, campaignKind);

  // 4. Classificar usando o catálogo
  let classification: Classification;
  try {
    classification = await classify(transcriptText, summary, catalog, campaignKind);
  } catch (e: any) {
    console.error("[lead-classify] classify failed", e);
    return j({ ok: false, error: e?.message ?? "classification failed" }, 500);
  }

  // 5. Resolver contact_id
  const contactId = await resolveContactId(admin, call as any);
  if (!contactId) {
    return j({ ok: false, error: "could not resolve or create contact" }, 500);
  }

  // 6. Resolver stage_id (só faz sentido para SDR; outros tipos usam tags/labels)
  const stageInfo = DEFAULT_SDR_SCORE[classification.category] ?? DEFAULT_SDR_SCORE.other;
  const stageId = campaignKind === "sdr"
    ? await resolveStageId(admin, (call as any).account_id, stageInfo.stageName)
    : null;

  // 5. Atualizar contact
  const updates: Record<string, any> = {
    score: classification.score,
    briefing: classification.briefing,
  };
  if (stageId) updates.stage_id = stageId;
  updates.source = (call as any).direction === "outbound" ? "outbound" : "inbound";

  // Só preenche o nome se ainda não existe (não pisa em edição manual / agent_tool).
  if (classification.contact_name) {
    const { data: existingContact } = await admin
      .from("contacts")
      .select("name")
      .eq("id", contactId)
      .maybeSingle();
    const currentName = (existingContact as any)?.name;
    if (!currentName || !String(currentName).trim()) {
      updates.name = classification.contact_name;
    }
  }

  await admin.from("contacts").update(updates).eq("id", contactId);

  // 6. Atualizar voice_calls
  await admin.from("voice_calls").update({
    outcome_category: classification.category,
    outcome_confidence: classification.confidence,
    outcome_summary: classification.summary,
    outcome_classified_at: new Date().toISOString(),
    classification: classification as any,
  }).eq("id", (call as any).id);

  // 7. Insere em conversation_outcomes (se tiver conversation_id)
  if ((call as any).conversation_id) {
    await admin.from("conversation_outcomes").insert({
      account_id: (call as any).account_id,
      conversation_id: (call as any).conversation_id,
      contact_id: contactId,
      outcome_type: classification.category,
      confidence: classification.confidence,
      source: "lead-classify-from-call",
      metadata: { score: classification.score, summary: classification.summary } as any,
    });
  }

  console.log(
    `[lead-classify] call=${(call as any).id} category=${classification.category} score=${classification.score} contact=${contactId} stage=${stageId ?? "—"}`,
  );

  return j({
    ok: true,
    voice_call_id: (call as any).id,
    contact_id: contactId,
    stage_id: stageId,
    classification,
  });
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
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

async function resolveContactId(admin: any, call: any): Promise<string | null> {
  // 1. metadata.contact_id (set by dispatchers like meeting-reminder-tick)
  const metaContactId = call.metadata?.contact_id;
  if (typeof metaContactId === "string" && metaContactId) return metaContactId;

  // 2. via conversation
  if (call.conversation_id) {
    const { data: conv } = await admin
      .from("conversations")
      .select("contact_id")
      .eq("id", call.conversation_id)
      .maybeSingle();
    if (conv?.contact_id) return conv.contact_id;
  }

  // 3. Em call inbound o lead é from_number; em outbound é to_number.
  const leadPhone = call.direction === "outbound" ? call.to_number : call.from_number;
  if (leadPhone) {
    const { data: existing } = await admin
      .from("contacts")
      .select("id")
      .eq("account_id", call.account_id)
      .eq("phone_number", leadPhone)
      .maybeSingle();
    if (existing?.id) return existing.id;

    // Seed nome se outbound/dispatcher carregou em metadata.
    const md = call.metadata ?? {};
    const seedRaw = md.lead_name ?? md.contact_name ?? md.invitee_name ?? md.dynamic_variables?.lead_name;
    const seedName = typeof seedRaw === "string" && seedRaw.trim().length >= 2 && seedRaw.trim().length <= 80
      ? seedRaw.trim()
      : null;

    // 4. Cria contact novo. Source só é inbound se a call foi inbound.
    const { data: created, error } = await admin
      .from("contacts")
      .insert({
        account_id: call.account_id,
        phone_number: leadPhone,
        source: call.direction === "outbound" ? "outbound" : "inbound",
        ...(seedName ? { name: seedName } : {}),
      })
      .select("id")
      .single();
    if (!error && created?.id) return created.id;
  }
  return null;
}

async function resolveStageId(admin: any, accountId: string, stageName: string): Promise<string | null> {
  const { data } = await admin
    .from("lead_pipelines")
    .select("id, lead_stages!inner(id, name)")
    .eq("account_id", accountId)
    .eq("is_default", true)
    .eq("lead_stages.name", stageName)
    .maybeSingle();
  const stages = (data as any)?.lead_stages;
  if (Array.isArray(stages) && stages[0]) return stages[0].id;
  if (stages && typeof stages === "object" && stages.id) return stages.id;
  return null;
}

async function classify(transcriptText: string, summary: string | null): Promise<Classification> {
  // Heuristic regex pass first (cheap, deterministic for óbvios)
  const text = (transcriptText + "\n" + (summary ?? "")).toLowerCase();
  const heuristicName = extractNameHeuristic(transcriptText);

  const heuristics: Array<{ category: OutcomeCategory; patterns: RegExp[] }> = [
    {
      category: "wrong_number",
      patterns: [/n[uú]mero errado/, /n[aã]o conhe[çc]o/, /pessoa errada/, /n[aã]o [eé] essa pessoa/],
    },
    {
      category: "voicemail",
      patterns: [/deixe (sua|uma) mensagem/, /caixa postal/, /ap[óo]s o sinal/],
    },
    {
      category: "scheduled",
      patterns: [/agend(ado|amos|ar) (uma )?reuni[aã]o/, /marcamos para/, /confirmado para/, /reuni[aã]o (na|em|dia)/, /remarcad[ao] para/, /remarcamos/],
    },
    {
      category: "callback",
      patterns: [/me lig[ua] (depois|mais tarde|amanh[aã])/, /retorn[ae] (depois|mais tarde)/, /agora n[aã]o posso/, /pode ligar (depois|amanh[aã])/],
    },
    {
      category: "not_interested",
      patterns: [/n[aã]o tenho interesse/, /n[aã]o me interessa/, /n[aã]o quero/, /sem interesse/, /n[aã]o [eé] pra mim/],
    },
    {
      category: "escalated",
      patterns: [/quero falar com (um humano|uma pessoa|atendente|gerente|recep[çc][aã]o)/, /me transfer/, /passa para algu[eé]m/],
    },
  ];

  for (const h of heuristics) {
    for (const p of h.patterns) {
      if (p.test(text)) {
        const base = STAGE_BY_CATEGORY[h.category];
        return {
          category: h.category,
          confidence: 0.92,
          score: base.score,
          summary: extractSummaryFromText(text, 200),
          briefing: emptyBriefing(),
          contact_name: heuristicName,
        };
      }
    }
  }

  // LLM fallback (Lovable AI Gateway)
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    return {
      category: "other",
      confidence: 0.3,
      score: 30,
      summary: summary ?? "",
      briefing: emptyBriefing(),
      contact_name: heuristicName,
    };
  }

  const sample = (transcriptText || summary || "").slice(0, 4000);
  const prompt = `Você é um analista de SDR. Analise a transcrição abaixo e devolva APENAS JSON válido (sem markdown).

Categorias possíveis:
- scheduled (agendou/remarcou consulta ou reunião)
- qualified (tem fit + interesse, mas não agendou)
- not_interested (sem fit/interesse)
- callback (pediu pra ligar depois)
- no_answer (ligação curta, caiu)
- voicemail (caixa postal)
- wrong_number (número errado)
- escalated (pediu humano sem qualificar)
- other

Transcrição:
${sample}

Responda EXATAMENTE neste formato:
{
  "category": "<uma das categorias>",
  "confidence": <0..1>,
  "score": <0..100, fit ou prioridade do lead>,
  "summary": "<1 frase em PT-BR resumindo o resultado>",
  "contact_name": "<nome próprio do lead/paciente. Considere QUALQUER sinal: (a) lead se apresenta ('meu nome é X', 'sou o X', 'aqui é a X', 'pode me chamar de X'); (b) agente chama o lead pelo nome ('Oi João!', 'Olá Maria, tudo bem?') E o lead responde naturalmente sem corrigir — isso é confirmação implícita; (c) terceiros confirmam o nome do lead. Use null APENAS se nenhum nome aparecer. Devolva só o primeiro nome (ou primeiro+segundo), sem títulos como 'Sr.', 'Dr.', 'Sra.'>",
  "briefing": {
    "dor": "<dor/motivo relatado pelo lead, ou null>",
    "fit": "<por que dá ou não dá fit, ou null>",
    "objections": ["<objeção 1>", "<objeção 2>"],
    "next_action": "<sugestão pro humano, ou null>"
  }
}`;

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      console.warn("[lead-classify] LLM call failed", res.status);
      return {
        category: "other",
        confidence: 0.3,
        score: 30,
        summary: summary ?? "",
        briefing: emptyBriefing(),
        contact_name: heuristicName,
      };
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content);
    const category: OutcomeCategory = (ALLOWED_CATEGORIES as readonly string[]).includes(parsed.category)
      ? parsed.category
      : "other";
    const confidence = typeof parsed.confidence === "number" ? clamp(parsed.confidence, 0, 1) : 0.5;
    const score = typeof parsed.score === "number" ? clamp(parsed.score, 0, 100) : STAGE_BY_CATEGORY[category].score;
    const llmName = typeof parsed.contact_name === "string"
      ? sanitizeName(parsed.contact_name)
      : null;
    const result: Classification = {
      category,
      confidence,
      score,
      summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 280) : (summary ?? ""),
      briefing: normalizeBriefing(parsed.briefing),
      contact_name: llmName ?? heuristicName,
    };
    return result;
  } catch (e) {
    console.error("[lead-classify] LLM exception", e);
    return {
      category: "other",
      confidence: 0.3,
      score: 30,
      summary: summary ?? "",
      briefing: emptyBriefing(),
      contact_name: heuristicName,
    };
  }
}

function extractNameHeuristic(transcriptText: string): string | null {
  if (!transcriptText) return null;
  const STOPWORDS = new Set([
    "voce", "você", "gente", "tudo", "certo", "sim", "nao", "não", "oi", "ola", "olá",
    "alo", "alô", "agente", "nina", "doutor", "doutora", "senhor", "senhora", "pessoal",
    "amigo", "amiga", "moço", "moca", "moça", "querido", "querida", "obrigado", "obrigada",
  ]);
  const tryName = (raw: string | undefined): string | null => {
    if (!raw) return null;
    const name = sanitizeName(raw);
    if (!name) return null;
    const first = name.split(/\s+/)[0]?.toLowerCase() ?? "";
    if (STOPWORDS.has(first)) return null;
    return name;
  };

  // Padrões aceitos em qualquer linha (lado lead ou agente).
  const linePatterns: RegExp[] = [
    // lead se apresenta
    /meu nome (?:é|eh|e)\s+([A-ZÀ-Ý][a-zà-ÿ]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ]+)?)/i,
    /(?:^|[\s,.])sou (?:o |a |um |uma )?([A-ZÀ-Ý][a-zà-ÿ]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ]+)?)/m,
    /aqui (?:é|eh|e)\s+(?:o |a )?([A-ZÀ-Ý][a-zà-ÿ]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ]+)?)/i,
    /(?:é|eh)\s+(?:o |a )([A-ZÀ-Ý][a-zà-ÿ]+)\s+falando/i,
    /quem fala (?:é|eh)\s+(?:o |a )?([A-ZÀ-Ý][a-zà-ÿ]+)/i,
    /pode me chamar de\s+([A-ZÀ-Ý][a-zà-ÿ]+)/i,
  ];

  for (const re of linePatterns) {
    const m = transcriptText.match(re);
    const cand = tryName(m?.[1]);
    if (cand) return cand;
  }

  // Sinal forte: agente cumprimentando o lead pelo nome.
  // Pega linhas que começam com "agent:" e procura "Oi/Olá X" ou
  // "bom dia X". Só aceita se o user, em alguma linha seguinte, NÃO
  // corrigir explicitamente ("não sou o X").
  const lines = transcriptText.split(/\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^agent:/i.test(line)) continue;
    const m = line.match(/(?:oi|olá|ola|alô|alo|bom dia|boa tarde|boa noite),?\s+([A-ZÀ-Ý][a-zà-ÿ]+)\b/i);
    const cand = tryName(m?.[1]);
    if (!cand) continue;
    // Procura correção em até 4 linhas seguintes do user.
    let corrected = false;
    for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
      const lj = lines[j].toLowerCase();
      if (/^user:/i.test(lines[j]) && /n[aã]o sou (?:o |a )?/i.test(lj)) {
        corrected = true;
        break;
      }
    }
    if (!corrected) return cand;
  }

  return null;
}

function sanitizeName(raw: string): string | null {
  const cleaned = raw.trim().replace(/[^\p{L}\s'-]/gu, "").trim();
  if (!cleaned) return null;
  if (cleaned.length < 2 || cleaned.length > 80) return null;
  // Capitaliza cada palavra.
  return cleaned
    .split(/\s+/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function emptyBriefing(): Briefing {
  return { dor: null, fit: null, objections: [], next_action: null };
}

function normalizeBriefing(b: any): Briefing {
  if (!b || typeof b !== "object") return emptyBriefing();
  const objections = Array.isArray(b.objections)
    ? b.objections.filter((x: any) => typeof x === "string").slice(0, 8)
    : [];
  return {
    dor: typeof b.dor === "string" ? b.dor.slice(0, 400) : null,
    fit: typeof b.fit === "string" ? b.fit.slice(0, 400) : null,
    objections,
    next_action: typeof b.next_action === "string" ? b.next_action.slice(0, 400) : null,
  };
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

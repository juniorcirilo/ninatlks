// Persona auto-reply for inbound messages.
//
// Hardened against loops: the previous version replied to every triggering
// message without checking the sender, the recency of prior replies, or the
// content. With Evolution echoing our own outbound messages back as inbound,
// it produced 100+ replies per minute to a single contact.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";
const CONTEXT_TURNS = 8;
// Don't send more than one auto-reply per N seconds in the same conversation.
const MIN_REPLY_GAP_SECONDS = 8;
// Hard daily cap per conversation (anti-loop circuit breaker).
const MAX_AUTO_REPLIES_PER_CONVERSATION_PER_HOUR = 30;

const SYSTEM_PROMPT_GUARDRAILS = `
INSTRUÇÕES OBRIGATÓRIAS:
- Responda em português do Brasil, em UMA mensagem curta (no máximo 2 frases).
- NUNCA use placeholders entre colchetes como [Nome do Cliente], [valor], [data], [Seu Nome], [Nome da Empresa]. Se você não tem o dado real, omita-o.
- NUNCA repita a saudação se já houver mensagens anteriores no histórico.
- Se a última mensagem do cliente estiver vazia ou for um placeholder como "[mensagem]", NÃO responda — retorne uma string vazia.
- Espere a resposta do cliente antes de avançar. Não envie várias perguntas seguidas.
`.trim();

const j = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method_not_allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return j({ error: "bad_json" }, 400); }

  const { accountId, conversationId, inboxId, triggeringMessageId } = body ?? {};
  if (!accountId || !conversationId || !triggeringMessageId) {
    return j({ error: "missing_params" }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 1) Load the triggering message; bail if it isn't a real Contact message.
  const { data: trigger } = await admin
    .from("messages")
    .select("id, sender_type, content, conversation_id, account_id")
    .eq("id", triggeringMessageId)
    .maybeSingle();
  if (!trigger) return j({ skipped: "trigger_not_found" });
  if (trigger.sender_type !== "Contact") return j({ skipped: "not_contact" });
  const txt = (trigger.content ?? "").trim();
  if (!txt || txt === "[mensagem]" || txt === "[mídia]") {
    return j({ skipped: "empty_or_placeholder" });
  }

  // 1.5) Human takeover guard — skip when operator paused the AI on this conversation.
  const { data: convFlags } = await admin
    .from("conversations")
    .select("additional_attributes")
    .eq("id", conversationId)
    .maybeSingle();
  if ((convFlags?.additional_attributes as any)?.ai_paused === true) {
    return j({ skipped: "ai_paused_by_operator" });
  }

  // 2) Rate-limit: most recent AgentBot reply within MIN_REPLY_GAP_SECONDS.
  const sinceGap = new Date(Date.now() - MIN_REPLY_GAP_SECONDS * 1000).toISOString();
  const { count: recentBotCount } = await admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("sender_type", "AgentBot")
    .gte("created_at", sinceGap);
  if ((recentBotCount ?? 0) > 0) {
    return j({ skipped: "rate_limited" });
  }

  // 3) Hourly circuit breaker.
  const sinceHour = new Date(Date.now() - 3600 * 1000).toISOString();
  const { count: hourCount } = await admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("sender_type", "AgentBot")
    .gte("created_at", sinceHour);
  if ((hourCount ?? 0) >= MAX_AUTO_REPLIES_PER_CONVERSATION_PER_HOUR) {
    console.warn(`[persona-auto-reply] hourly cap hit for conv ${conversationId}`);
    return j({ skipped: "hourly_cap" });
  }

  // 4) Resolve persona (deployment for inbox, else any account persona).
  let personaId: string | null = null;
  let systemPrompt = "Você é um agente de cobrança humano e cordial.";
  if (inboxId) {
    const { data: dep } = await admin
      .from("agent_persona_deployments")
      .select("persona_id")
      .eq("account_id", accountId)
      .eq("inbox_id", inboxId)
      .eq("enabled", true)
      .maybeSingle();
    if (dep?.persona_id) personaId = dep.persona_id;
  }
  if (!personaId) {
    const { data: anyPersona } = await admin
      .from("agent_personas")
      .select("id")
      .eq("account_id", accountId)
      .eq("enabled", true)
      .limit(1)
      .maybeSingle();
    if (anyPersona) personaId = anyPersona.id;
  }
  if (personaId) {
    const { data: persona } = await admin
      .from("agent_personas")
      .select("system_prompt")
      .eq("id", personaId)
      .maybeSingle();
    if (persona?.system_prompt) systemPrompt = persona.system_prompt;
  }
  systemPrompt = `${systemPrompt}\n\n${SYSTEM_PROMPT_GUARDRAILS}`;

  // 5) Load short history (oldest → newest).
  const { data: recent } = await admin
    .from("messages")
    .select("content, sender_type, created_at")
    .eq("conversation_id", conversationId)
    .eq("private", false)
    .order("created_at", { ascending: false })
    .limit(CONTEXT_TURNS);
  const history = (recent ?? [])
    .reverse()
    .filter((m: any) => {
      const c = (m.content ?? "").trim();
      return c && c !== "[mensagem]" && c !== "[mídia]";
    })
    .map((m: any) => ({
      role: (m.sender_type === "Contact" ? "user" : "assistant") as "user" | "assistant",
      content: m.content as string,
    }));

  // 6) Generate reply.
  const lovableKey = Deno.env.get("LOVABLE_API_KEY") ?? "";
  if (!lovableKey) return j({ error: "missing_LOVABLE_API_KEY" }, 500);

  let reply = "";
  try {
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          ...history,
        ],
        max_tokens: 200,
        temperature: 0.5,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error(`[persona-auto-reply] gateway ${res.status}: ${errBody.slice(0, 200)}`);
      return j({ error: "llm_failed", status: res.status }, 502);
    }
    const data = await res.json();
    reply = (data?.choices?.[0]?.message?.content ?? "").trim();
  } catch (err) {
    console.error("[persona-auto-reply] llm error", err);
    return j({ error: "llm_exception" }, 502);
  }

  // Strip residual placeholders just in case.
  reply = reply.replace(/\[(?:Nome do Cliente|Seu Nome|Nome da Empresa|valor|data|valor da dívida|data do vencimento|Valor do Débito)\]/gi, "").trim();
  if (!reply) return j({ skipped: "empty_reply" });

  // 7) Persist the AgentBot message (no dispatch from this function — the
  // channel-specific sender owns delivery).
  const { data: inserted, error: insErr } = await admin
    .from("messages")
    .insert({
      account_id: accountId,
      conversation_id: conversationId,
      inbox_id: inboxId ?? null,
      content: reply,
      content_type: 0,
      message_type: 1,
      sender_type: "AgentBot",
      sender_id: personaId,
      private: false,
      content_attributes: { kind: "auto_reply" },
    })
    .select("id")
    .single();
  if (insErr) {
    console.error("[persona-auto-reply] insert failed", insErr.message);
    return j({ error: "insert_failed" }, 500);
  }

  // 8) Hand off to the channel sender (best-effort — if it fails, the message
  // stays as an internal record but we don't loop).
  try {
    await admin.functions.invoke("channels-send", {
      body: {
        accountId,
        conversationId,
        messageId: inserted.id,
      },
    });
  } catch (err) {
    console.warn("[persona-auto-reply] channels-send failed", err);
  }

  return j({ ok: true, messageId: inserted.id });
});

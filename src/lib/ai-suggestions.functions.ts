// Sugestão de resposta IA para cockpit de takeover humano (Fase 2B).
//
// Carrega últimas N mensagens + persona vinculada ao inbox + perfil do contato
// e pede ao Lovable AI Gateway uma sugestão curta em PT-BR pronta pra o atendente
// humano colar/editar antes de mandar. Stream-only: o handler é generator pra
// reduzir latência percebida no cockpit.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";
const HISTORY_LIMIT = 12;

export const suggestReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      conversationId: z.string().uuid(),
      tone: z.enum(["neutral", "friendly", "formal", "empathetic"]).default("friendly"),
      hint: z.string().max(280).optional(),
    }).parse(d),
  )
  .handler(async function* ({ data, context }) {
    const { supabase } = context;

    const [{ data: conv }, { data: msgs }] = await Promise.all([
      supabase
        .from("conversations")
        .select("id, account_id, inbox_id, contact_id, contacts(name, briefing), inboxes(name, channel_type)")
        .eq("id", data.conversationId)
        .maybeSingle(),
      supabase
        .from("messages")
        .select("content, sender_type, created_at")
        .eq("conversation_id", data.conversationId)
        .eq("private", false)
        .order("created_at", { ascending: false })
        .limit(HISTORY_LIMIT),
    ]);

    if (!conv) {
      yield { delta: "Conversa não encontrada." };
      return;
    }

    // Persona ativa do inbox (se houver).
    const { data: deployment } = await supabase
      .from("agent_persona_deployments")
      .select("agent_personas(name, system_prompt)")
      .eq("inbox_id", (conv as { inbox_id: string }).inbox_id)
      .eq("enabled", true)
      .limit(1)
      .maybeSingle();
    const persona =
      (deployment as { agent_personas?: { name?: string; system_prompt?: string } } | null)
        ?.agent_personas ?? null;

    const contact = (conv as { contacts?: { name?: string; briefing?: unknown } }).contacts ?? {};
    const history = (msgs ?? [])
      .reverse()
      .map((m) => ({
        role: m.sender_type === "Contact" ? ("user" as const) : ("assistant" as const),
        content: (m.content as string | null) ?? "",
      }))
      .filter((m) => m.content.trim().length > 0);

    const toneMap: Record<string, string> = {
      neutral: "neutro e direto",
      friendly: "amigável e próximo, mas profissional",
      formal: "formal e respeitoso",
      empathetic: "empático e acolhedor",
    };

    const system = [
      persona?.system_prompt ?? "Você é um assistente de atendimento ao cliente.",
      "",
      "TAREFA: Sugerir UMA resposta curta (máx 3 frases) que o atendente humano possa enviar agora.",
      `TOM: ${toneMap[data.tone]}`,
      "REGRAS:",
      "- Responda em português brasileiro.",
      "- Não invente fatos, preços ou prazos.",
      "- Se faltar informação, peça gentilmente.",
      "- Não use placeholders tipo [NOME] ou [DATA].",
      "- Não inclua saudação se a conversa já está em andamento.",
      contact.name ? `Cliente se chama: ${contact.name}` : "",
      data.hint ? `Direção do atendente: ${data.hint}` : "",
    ].filter(Boolean).join("\n");

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      yield { delta: "LOVABLE_API_KEY não configurado." };
      return;
    }

    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        temperature: 0.6,
        max_tokens: 220,
        messages: [
          { role: "system", content: system },
          ...history,
          { role: "user", content: "Gere a sugestão agora." },
        ],
      }),
    });

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      yield { delta: `Erro IA (${res.status}): ${body.slice(0, 120)}` };
      return;
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const events = buf.split("\n\n");
      buf = events.pop() ?? "";
      for (const raw of events) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const obj = JSON.parse(payload);
          const token = obj?.choices?.[0]?.delta?.content;
          if (typeof token === "string" && token.length > 0) {
            yield { delta: token };
          }
        } catch {
          /* partial chunk */
        }
      }
    }
  });

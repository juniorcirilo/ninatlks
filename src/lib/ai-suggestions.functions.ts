import { query } from "@/lib/db";
// Sugestão de resposta IA para cockpit de takeover humano (Fase 2B).
//
// Carrega últimas N mensagens + persona vinculada ao inbox + perfil do contato
// e pede ao Lovable AI Gateway uma sugestão curta em PT-BR pronta pra o atendente
// humano colar/editar antes de mandar. Stream-only: o handler é generator pra
// reduzir latência percebida no cockpit.

import { createServerFn } from "@tanstack/react-start";
import { requireSessionAuth } from "@/lib/session-middleware";
import { z } from "zod";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";
const HISTORY_LIMIT = 12;

export const suggestReply = createServerFn({ method: "POST" })
  .middleware([requireSessionAuth])
  .inputValidator((d) =>
    z
      .object({
        conversationId: z.string().uuid(),
        tone: z.enum(["neutral", "friendly", "formal", "empathetic"]).default("friendly"),
        hint: z.string().max(280).optional(),
      })
      .parse(d),
  )
  .handler(async function* ({ data, context }) {
    const accountId = context.accountId;
    if (!accountId) throw new Error("Unauthorized");

    const [convRows, msgs] = await Promise.all([
      query<{
        id: string;
        account_id: string;
        inbox_id: string;
        contact_id: string;
        contact_name: string | null;
        contact_briefing: unknown;
        inbox_name: string | null;
        inbox_channel_type: string | null;
      }>(
        `SELECT c.id, c.account_id, c.inbox_id, c.contact_id,
                ct.name AS contact_name, ct.briefing AS contact_briefing,
                i.name AS inbox_name, i.channel_type AS inbox_channel_type
         FROM conversations c
         LEFT JOIN contacts ct ON ct.id = c.contact_id
         LEFT JOIN inboxes i ON i.id = c.inbox_id
         WHERE c.id = $1
         LIMIT 1`,
        [data.conversationId],
      ),
      query<{ content: string | null; sender_type: string; created_at: string }>(
        `SELECT content, sender_type, created_at
         FROM messages
         WHERE conversation_id = $1 AND private = $2
         ORDER BY created_at DESC
         LIMIT $3`,
        [data.conversationId, false, HISTORY_LIMIT],
      ),
    ]);
    const conv = convRows[0] ?? null;

    if (!conv) {
      yield { delta: "Conversa não encontrada." };
      return;
    }

    const accountId2 = conv.account_id ?? accountId;

    // Persona ativa do inbox (se houver).
    const deploymentRows = await query<{
      persona_name: string | null;
      persona_system_prompt: string | null;
    }>(
      `SELECT ap.name AS persona_name, ap.system_prompt AS persona_system_prompt
       FROM agent_persona_deployments d
       LEFT JOIN agent_personas ap ON ap.id = d.persona_id
       WHERE d.inbox_id = $1 AND d.enabled = TRUE
       LIMIT 1`,
      [conv.inbox_id],
    );
    const personaRow = deploymentRows[0] ?? null;
    const persona = personaRow
      ? {
          name: personaRow.persona_name ?? undefined,
          system_prompt: personaRow.persona_system_prompt ?? undefined,
        }
      : null;

    const contact = {
      name: conv.contact_name,
      briefing: conv.contact_briefing,
    };
    const history = (msgs ?? [])
      .reverse()
      .map((m: any) => ({
        role: m.sender_type === "Contact" ? ("user" as const) : ("assistant" as const),
        content: (m.content as string | null) ?? "",
      }))
      .filter((m: any) => m.content.trim().length > 0);

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
    ]
      .filter(Boolean)
      .join("\n");

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

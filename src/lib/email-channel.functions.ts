import { query, insert } from "@/lib/db";
// Canal Email via Resend (Fase 2C — Omnichannel+).
//
// `sendOutboundEmail`: enviar mensagem outbound numa conversation de canal=email.
// Cria mensagem em `messages` e dispara via Resend API. Suporta reply-to com
// header `In-Reply-To` para manter threading do lado do cliente de email.

import { createServerFn } from "@tanstack/react-start";
import { requireSessionAuth } from "@/lib/session-middleware";
import { z } from "zod";

const RESEND_URL = "https://api.resend.com/emails";

export const sendOutboundEmail = createServerFn({ method: "POST" })
  .middleware([requireSessionAuth])
  .inputValidator((d) =>
    z
      .object({
        conversationId: z.string().uuid(),
        subject: z.string().min(1).max(200),
        html: z.string().min(1).max(50_000),
        replyToMessageId: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;

    const convRows = await query<{
      id: string;
      account_id: string;
      contact_id: string;
      inbox_id: string;
      contact_email: string | null;
      contact_name: string | null;
      inbox_channel_type: string | null;
      inbox_name: string | null;
    }>(
      `SELECT c.id, c.account_id, c.contact_id, c.inbox_id,
              ct.email AS contact_email, ct.name AS contact_name,
              i.channel_type AS inbox_channel_type, i.name AS inbox_name
       FROM conversations c
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       LEFT JOIN inboxes i ON i.id = c.inbox_id
       WHERE c.id = $1
       LIMIT 1`,
      [data.conversationId],
    );
    const conv = convRows[0] ?? null;
    if (!conv) throw new Error("Conversa não encontrada");

    if (conv.inbox_channel_type !== "email") {
      throw new Error(`Conversa não é de canal email (é ${conv.inbox_channel_type ?? "?"})`);
    }
    const to = conv.contact_email;
    if (!to) throw new Error("Contato sem email cadastrado");

    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;
    if (!apiKey) throw new Error("RESEND_API_KEY não configurado");
    if (!from) throw new Error("RESEND_FROM_EMAIL não configurado");

    const headers: Record<string, string> = {};
    if (data.replyToMessageId) headers["In-Reply-To"] = data.replyToMessageId;

    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: data.subject,
        html: data.html,
        headers,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      throw new Error(`Resend ${res.status}: ${body.message ?? "erro desconhecido"}`);
    }

    const insertedRows = await insert<Record<string, unknown>>("messages", {
      account_id: conv.account_id,
      conversation_id: data.conversationId,
      inbox_id: conv.inbox_id,
      content: data.html,
      content_type: 4,
      message_type: 1,
      sender_type: "User",
      sender_id: userId,
      content_attributes: {
        kind: "email",
        subject: data.subject,
        provider_message_id: body.id ?? null,
      },
    });
    const inserted = insertedRows[0];

    return { ok: true, messageId: inserted.id, providerMessageId: body.id ?? null };
  });

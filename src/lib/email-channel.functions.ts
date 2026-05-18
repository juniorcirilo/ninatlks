// Canal Email via Resend (Fase 2C — Omnichannel+).
//
// `sendOutboundEmail`: enviar mensagem outbound numa conversation de canal=email.
// Cria mensagem em `messages` e dispara via Resend API. Suporta reply-to com
// header `In-Reply-To` para manter threading do lado do cliente de email.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const RESEND_URL = "https://api.resend.com/emails";

export const sendOutboundEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      conversationId: z.string().uuid(),
      subject: z.string().min(1).max(200),
      html: z.string().min(1).max(50_000),
      replyToMessageId: z.string().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: conv, error } = await supabase
      .from("conversations")
      .select("id, account_id, contact_id, inbox_id, contacts(email, name), inboxes(channel_type, name)")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!conv) throw new Error("Conversa não encontrada");

    const inbox = (conv as { inboxes?: { channel_type?: string; name?: string } }).inboxes ?? {};
    if (inbox.channel_type !== "email") {
      throw new Error(`Conversa não é de canal email (é ${inbox.channel_type ?? "?"})`);
    }
    const to = (conv as { contacts?: { email?: string } }).contacts?.email;
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

    const { data: inserted, error: insErr } = await supabase
      .from("messages")
      .insert([
        {
          account_id: (conv as { account_id: string }).account_id,
          conversation_id: data.conversationId,
          inbox_id: (conv as { inbox_id: string }).inbox_id,
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
        },
      ])
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);

    return { ok: true, messageId: inserted.id, providerMessageId: body.id ?? null };
  });

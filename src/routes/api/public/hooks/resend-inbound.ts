// Webhook público para emails inbound (Resend → Nexus, Fase 2C).
//
// O Resend pode encaminhar emails recebidos no domínio configurado via webhook.
// Aqui validamos assinatura HMAC (svix-style), encontramos/criamos contato
// pelo email do remetente e gravamos como mensagem inbound numa conversa
// no inbox de canal=email.
//
// Setup no Resend: criar Webhook → Email.received → URL desta rota → secret
// gravado em RESEND_WEBHOOK_SECRET.

import { createHmac, timingSafeEqual } from "node:crypto";
import { query, getOne, insert } from "@/lib/db";

interface ResendInboundPayload {
  type?: string;
  data?: {
    from?: { email?: string; name?: string };
    to?: Array<{ email?: string }>;
    subject?: string;
    text?: string;
    html?: string;
    headers?: Record<string, string>;
    email_id?: string;
  };
}

function verifySignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/public/hooks/resend-inbound")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.text();
        const secret = process.env.RESEND_WEBHOOK_SECRET;
        if (!secret) return new Response("not configured", { status: 503 });

        const sig =
          request.headers.get("resend-signature") ??
          request.headers.get("x-webhook-signature");
        if (!verifySignature(body, sig, secret)) {
          return new Response("invalid signature", { status: 401 });
        }

        let payload: ResendInboundPayload;
        try {
          payload = JSON.parse(body);
        } catch {
          return new Response("invalid json", { status: 400 });
        }

        if (payload.type !== "email.received" && payload.type !== "email.inbound") {
          return new Response("ignored", { status: 200 });
        }

        const fromEmail = payload.data?.from?.email?.toLowerCase().trim();
        const toEmail = payload.data?.to?.[0]?.email?.toLowerCase().trim();
        if (!fromEmail || !toEmail) return new Response("missing addresses", { status: 400 });

        // Achar inbox por endereço (config.address) ou primeiro email inbox do account.
        const channel = await getOne(
          `SELECT c.id, c.account_id, i.id as inbox_id FROM channels c
           LEFT JOIN inboxes i ON i.channel_id = c.id
           WHERE c.channel_type = 'email' AND c.config->>'address' = $1
           LIMIT 1`,
          [toEmail],
        );

        let inboxId: string | null = null;
        let accountId: string | null = null;
        if (channel) {
          accountId = channel.account_id;
          inboxId = channel.inbox_id ?? null;
        } else {
          const anyInbox = await getOne(
            `SELECT id, account_id FROM inboxes WHERE channel_type = 'email' LIMIT 1`,
          );
          inboxId = anyInbox?.id ?? null;
          accountId = anyInbox?.account_id ?? null;
        }

        if (!inboxId || !accountId) {
          return new Response("no email inbox configured", { status: 404 });
        }

        // Upsert contact por email no account.
        const existingContact = await getOne(
          `SELECT id FROM contacts WHERE account_id = $1 AND email = $2`,
          [accountId, fromEmail],
        );

        let contactId = existingContact?.id ?? null;
        if (!contactId) {
          const newContact = await insert("contacts", {
            account_id: accountId,
            email: fromEmail,
            name: payload.data?.from?.name ?? fromEmail,
            source: "email",
          });
          contactId = newContact[0]?.id;
        }

        // Achar conversation ativa (status=0) ou criar nova.
        const openConv = await getOne(
          `SELECT id FROM conversations WHERE contact_id = $1 AND inbox_id = $2 AND status = 0 ORDER BY last_activity_at DESC LIMIT 1`,
          [contactId, inboxId],
        );

        let conversationId = openConv?.id ?? null;
        if (!conversationId) {
          const newConv = await insert("conversations", {
            account_id: accountId,
            inbox_id: inboxId,
            contact_id: contactId,
            status: 0,
            additional_attributes: { email_subject: payload.data?.subject ?? "" },
          });
          conversationId = newConv[0]?.id;
        }

        const content = (payload.data?.text ?? payload.data?.html ?? "").slice(0, 50_000);
        await insert("messages", {
          account_id: accountId,
          conversation_id: conversationId,
          inbox_id: inboxId,
          content,
          content_type: 4,
          message_type: 0,
          sender_type: "Contact",
          sender_id: contactId,
          source_id: payload.data?.email_id ?? null,
          content_attributes: {
            kind: "email",
            subject: payload.data?.subject ?? "",
            headers: payload.data?.headers ?? {},
          },
        });

        return new Response(JSON.stringify({ ok: true, conversationId }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});

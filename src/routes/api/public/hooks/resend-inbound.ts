// Webhook público para emails inbound (Resend → Nexus, Fase 2C).
//
// O Resend pode encaminhar emails recebidos no domínio configurado via webhook.
// Aqui validamos assinatura HMAC (svix-style), encontramos/criamos contato
// pelo email do remetente e gravamos como mensagem inbound numa conversa
// no inbox de canal=email.
//
// Setup no Resend: criar Webhook → Email.received → URL desta rota → secret
// gravado em RESEND_WEBHOOK_SECRET.

import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
          // Outros eventos (delivered, bounced) — apenas logar.
          return new Response("ignored", { status: 200 });
        }

        const fromEmail = payload.data?.from?.email?.toLowerCase().trim();
        const toEmail = payload.data?.to?.[0]?.email?.toLowerCase().trim();
        if (!fromEmail || !toEmail) return new Response("missing addresses", { status: 400 });

        // Achar inbox por endereço (config.address) ou primeiro email inbox do account.
        const { data: channel } = await supabaseAdmin
          .from("channels")
          .select("id, account_id, inboxes(id)")
          .eq("channel_type", "email")
          .filter("config->>address", "eq", toEmail)
          .limit(1)
          .maybeSingle();

        let inboxId: string | null = null;
        let accountId: string | null = null;
        if (channel) {
          accountId = (channel as { account_id: string }).account_id;
          inboxId =
            ((channel as { inboxes?: Array<{ id: string }> }).inboxes ?? [])[0]?.id ?? null;
        } else {
          // Fallback: primeiro inbox email do único account (single-tenant).
          const { data: anyInbox } = await supabaseAdmin
            .from("inboxes")
            .select("id, account_id")
            .eq("channel_type", "email")
            .limit(1)
            .maybeSingle();
          inboxId = (anyInbox as { id?: string } | null)?.id ?? null;
          accountId = (anyInbox as { account_id?: string } | null)?.account_id ?? null;
        }

        if (!inboxId || !accountId) {
          return new Response("no email inbox configured", { status: 404 });
        }

        // Upsert contact por email no account.
        const { data: existingContact } = await supabaseAdmin
          .from("contacts")
          .select("id")
          .eq("account_id", accountId)
          .eq("email", fromEmail)
          .maybeSingle();

        let contactId = (existingContact as { id?: string } | null)?.id ?? null;
        if (!contactId) {
          const { data: newContact, error: cErr } = await supabaseAdmin
            .from("contacts")
            .insert([{
              account_id: accountId,
              email: fromEmail,
              name: payload.data?.from?.name ?? fromEmail,
              source: "email",
            }])
            .select("id")
            .single();
          if (cErr) return new Response(`contact: ${cErr.message}`, { status: 500 });
          contactId = newContact.id;
        }

        // Achar conversation ativa (status=0) ou criar nova.
        const { data: openConv } = await supabaseAdmin
          .from("conversations")
          .select("id")
          .eq("contact_id", contactId)
          .eq("inbox_id", inboxId)
          .eq("status", 0)
          .order("last_activity_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        let conversationId = (openConv as { id?: string } | null)?.id ?? null;
        if (!conversationId) {
          const { data: newConv, error: convErr } = await supabaseAdmin
            .from("conversations")
            .insert([{
              account_id: accountId,
              inbox_id: inboxId,
              contact_id: contactId,
              status: 0,
              additional_attributes: { email_subject: payload.data?.subject ?? "" },
            }])
            .select("id")
            .single();
          if (convErr) return new Response(`conv: ${convErr.message}`, { status: 500 });
          conversationId = newConv.id;
        }

        const content = (payload.data?.text ?? payload.data?.html ?? "").slice(0, 50_000);
        const { error: mErr } = await supabaseAdmin.from("messages").insert([{
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
        }]);
        if (mErr) return new Response(`msg: ${mErr.message}`, { status: 500 });

        return new Response(JSON.stringify({ ok: true, conversationId }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});

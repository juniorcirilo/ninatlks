// Public webhook for Evolution API (WhatsApp via Baileys).
//
// Evolution sends MANY event kinds to this endpoint, including
// status/delivery/read receipts and our own outbound messages echoed back
// (`fromMe: true`). Treating those as inbound user messages is what caused
// the test contact to receive 100+ AI replies in 2 hours.
//
// This handler is strict by design: it processes ONLY real, user-typed,
// inbound text/media messages. Everything else returns 200 with no effect.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

const ok = (body: unknown = { ok: true }) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Events that are safe to drop on the floor without inspection. These never
// represent a new inbound user message.
const IGNORED_EVENTS = new Set<string>([
  "MESSAGES_UPDATE", // delivery/read receipts (SERVER_ACK, DELIVERY_ACK, READ)
  "MESSAGES_DELETE",
  "PRESENCE_UPDATE",
  "CHATS_UPDATE",
  "CHATS_UPSERT",
  "CHATS_DELETE",
  "CONTACTS_UPDATE",
  "CONTACTS_UPSERT",
  "GROUPS_UPSERT",
  "GROUP_UPDATE",
  "GROUP_PARTICIPANTS_UPDATE",
  "CONNECTION_UPDATE",
  "QRCODE_UPDATED",
  "SEND_MESSAGE", // our own outbound being echoed
  "MESSAGES_SET",
  "TYPEBOT_START",
  "TYPEBOT_CHANGE_STATUS",
  "CALL",
  "LABELS_EDIT",
  "LABELS_ASSOCIATION",
]);

// Real user-typed inbound message types. Anything else (protocolMessage,
// reactionMessage, ephemeralMessage payloads with no text, etc.) is dropped.
const ACCEPTED_MESSAGE_TYPES = new Set<string>([
  "conversation",
  "extendedTextMessage",
  "imageMessage",
  "audioMessage",
  "videoMessage",
  "documentMessage",
  "stickerMessage",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return ok();

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return ok();
  }

  const event = String(payload?.event ?? "").toUpperCase();
  const data = payload?.data ?? payload;

  // 1) Drop status/receipts and other non-message events entirely.
  if (event && event !== "MESSAGES_UPSERT") {
    if (IGNORED_EVENTS.has(event)) return ok({ ignored: event });
    // Unknown event — ignore to be safe (we can re-enable specific events later).
    console.log(`[evolution-incoming] dropping unknown event=${event}`);
    return ok({ ignored: event });
  }

  // 2) Drop anything our own number sent (echo of outbound).
  const fromMe = data?.key?.fromMe === true || data?.fromMe === true;
  if (fromMe) {
    return ok({ ignored: "fromMe" });
  }

  // 3) Only accept real text/media messages.
  const messageType = String(
    data?.messageType ?? data?.message?.messageType ?? "",
  );
  if (messageType && !ACCEPTED_MESSAGE_TYPES.has(messageType)) {
    return ok({ ignored: `messageType:${messageType}` });
  }

  // 4) Extract real text. Support the common Baileys shapes.
  const msg = data?.message ?? {};
  const text: string =
    (typeof msg.conversation === "string" && msg.conversation) ||
    (msg.extendedTextMessage && typeof msg.extendedTextMessage.text === "string"
      ? msg.extendedTextMessage.text
      : "") ||
    (msg.imageMessage && typeof msg.imageMessage.caption === "string"
      ? msg.imageMessage.caption
      : "") ||
    (msg.videoMessage && typeof msg.videoMessage.caption === "string"
      ? msg.videoMessage.caption
      : "") ||
    (msg.documentMessage && typeof msg.documentMessage.caption === "string"
      ? msg.documentMessage.caption
      : "") ||
    "";

  const hasMedia = !!(
    msg.imageMessage || msg.audioMessage || msg.videoMessage ||
    msg.documentMessage || msg.stickerMessage
  );

  // 5) If there is no real text and no media, it's a stub/protocol message —
  // drop it. NEVER persist a literal "[mensagem]" placeholder.
  if (!text.trim() && !hasMedia) {
    console.log(
      `[evolution-incoming] dropping empty payload msgType=${messageType} keys=${Object.keys(msg).join(",")}`,
    );
    return ok({ ignored: "empty" });
  }

  // 6) Identify the sender + instance.
  const remoteJid: string =
    data?.key?.remoteJid ?? data?.remoteJid ?? "";
  if (!remoteJid) return ok({ ignored: "no_remoteJid" });

  // Group messages: skip for now (would need group routing).
  if (remoteJid.endsWith("@g.us")) return ok({ ignored: "group" });

  const instanceName: string =
    payload?.instance ?? data?.instance ?? data?.instanceName ?? "";
  const messageId: string =
    data?.key?.id ?? data?.keyId ?? data?.messageId ?? "";
  if (!messageId) return ok({ ignored: "no_messageId" });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    await handleMessage(supabase, {
      instanceName,
      remoteJid,
      messageId,
      text: text.trim() || (hasMedia ? "[mídia]" : ""),
      hasMedia,
      pushName: data?.pushName ?? null,
    });
  } catch (err) {
    console.error("[evolution-incoming] handle failed", err);
  }

  return ok();
});

async function handleMessage(
  admin: SupabaseClient,
  args: {
    instanceName: string;
    remoteJid: string;
    messageId: string;
    text: string;
    hasMedia: boolean;
    pushName: string | null;
  },
) {
  const { instanceName, remoteJid, messageId, text, hasMedia, pushName } = args;

  // Resolve channel by Evolution instance name (stored in channels.config).
  let { data: channel } = await admin
    .from("channels")
    .select("id, account_id, config")
    .eq("channel_type", "whatsapp")
    .filter("config->>instance_name", "eq", instanceName)
    .maybeSingle();

  // Fall back to any whatsapp channel if instance lookup failed (single-tenant test).
  if (!channel) {
    const { data: anyChannel } = await admin
      .from("channels")
      .select("id, account_id, config")
      .eq("channel_type", "whatsapp")
      .limit(1)
      .maybeSingle();
    channel = anyChannel ?? null;
  }
  if (!channel) {
    console.warn("[evolution-incoming] no whatsapp channel for instance", instanceName);
    return;
  }
  const accountId = channel.account_id;

  // Inbox auto-provision.
  let { data: inbox } = await admin
    .from("inboxes")
    .select("id")
    .eq("channel_id", channel.id)
    .maybeSingle();
  if (!inbox) {
    const { data: created } = await admin
      .from("inboxes")
      .insert({
        account_id: accountId,
        channel_id: channel.id,
        channel_type: "whatsapp",
        name: "WhatsApp",
      })
      .select("id")
      .single();
    inbox = created!;
  }

  // Normalize remoteJid → identifier. Strip lid suffix (`:46`) and domain.
  const baseJid = remoteJid.replace(/:\d+@/, "@").split("@")[0];
  const identifier = `evolution:whatsapp:${baseJid}`;

  // Look up existing contact by identifier — DO NOT create duplicates.
  let { data: contact } = await admin
    .from("contacts")
    .select("id")
    .eq("account_id", accountId)
    .eq("identifier", identifier)
    .maybeSingle();
  if (!contact) {
    const { data: created } = await admin
      .from("contacts")
      .insert({
        account_id: accountId,
        identifier,
        name: pushName ?? "WhatsApp (sem número)",
      })
      .select("id")
      .single();
    contact = created!;
  }

  await admin.from("contact_inboxes").upsert(
    { contact_id: contact.id, inbox_id: inbox.id, source_id: identifier },
    { onConflict: "contact_id,inbox_id", ignoreDuplicates: true },
  );

  // Reuse the most recent open conversation for this contact+inbox.
  let { data: conversation } = await admin
    .from("conversations")
    .select("id")
    .eq("account_id", accountId)
    .eq("contact_id", contact.id)
    .eq("inbox_id", inbox.id)
    .eq("status", 0)
    .order("last_activity_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!conversation) {
    const { data: created } = await admin
      .from("conversations")
      .insert({
        account_id: accountId,
        contact_id: contact.id,
        inbox_id: inbox.id,
        status: 0,
      })
      .select("id")
      .single();
    conversation = created!;
  }

  // Insert message; dedup by (account_id, source_id) — Evolution can retry
  // the same webhook, and the WA messageId is globally unique.
  const { data: inserted, error: insErr } = await admin
    .from("messages")
    .upsert(
      {
        account_id: accountId,
        conversation_id: conversation.id,
        inbox_id: inbox.id,
        content: text,
        content_type: hasMedia ? 1 : 0,
        message_type: 0,
        private: false,
        sender_type: "Contact",
        sender_id: contact.id,
        source_id: messageId,
        external_source_ids: { evolution_message_id: messageId },
        content_attributes: hasMedia ? { kind: "media" } : { kind: "text" },
      },
      { onConflict: "account_id,source_id", ignoreDuplicates: true },
    )
    .select("id")
    .single();
  if (insErr && !/duplicate/i.test(insErr.message)) {
    console.error("[evolution-incoming] insert failed", insErr.message);
    return;
  }
  if (!inserted) {
    // Duplicate — already processed. Don't re-fire the AI.
    return;
  }

  await admin
    .from("conversations")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", conversation.id);

  // Fire auto-reply (best-effort). The function has its own loop guards.
  try {
    await admin.functions.invoke("persona-auto-reply", {
      body: {
        accountId,
        conversationId: conversation.id,
        inboxId: inbox.id,
        triggeringMessageId: inserted.id,
      },
    });
  } catch (err) {
    console.warn("[evolution-incoming] auto-reply invoke failed", err);
  }
}

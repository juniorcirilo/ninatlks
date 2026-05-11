// deno-lint-ignore-file no-explicit-any
//
// Operator sends a manual WhatsApp message via Evolution from the Live Chat UI.
// - Resolves the conversation, contact, inbox, and channel config
// - Sends via Evolution sendText
// - Records the outgoing message in `messages` (sender_type=User, message_type=1)
//
// Body: { conversation_id: uuid, content: string }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { sendText } from "../_shared/evolution/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return j({ error: "missing auth" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Resolve operator user
  const { data: userRes } = await admin.auth.getUser(jwt);
  const userId = userRes?.user?.id;
  if (!userId) return j({ error: "invalid token" }, 401);

  let body: { conversation_id?: string; content?: string };
  try { body = await req.json(); } catch { return j({ error: "bad json" }, 400); }
  const conversationId = body.conversation_id;
  const text = (body.content ?? "").trim();
  if (!conversationId) return j({ error: "conversation_id required" }, 400);
  if (!text) return j({ error: "content required" }, 400);
  if (text.length > 4000) return j({ error: "content too long" }, 413);

  // Load conversation + contact + inbox
  const { data: conv } = await admin
    .from("conversations")
    .select("id, account_id, inbox_id, contact_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return j({ error: "conversation not found" }, 404);

  // Verify membership
  const { data: member } = await admin
    .from("account_users")
    .select("id")
    .eq("account_id", conv.account_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!member) return j({ error: "forbidden" }, 403);

  const { data: contact } = await admin
    .from("contacts")
    .select("id, name, phone_number, identifier")
    .eq("id", conv.contact_id)
    .maybeSingle();
  if (!contact?.phone_number && !contact?.identifier) {
    return j({ error: "contact has no phone" }, 409);
  }

  // Channel config (whatsapp / evolution)
  const { data: inbox } = await admin
    .from("inboxes")
    .select("id, channel_id, channel_type")
    .eq("id", conv.inbox_id)
    .maybeSingle();
  if (!inbox || inbox.channel_type !== "whatsapp") {
    return j({ error: "inbox is not a whatsapp channel" }, 409);
  }

  let cfg: any = null;
  if (inbox.channel_id) {
    const { data: ch } = await admin
      .from("channels")
      .select("config")
      .eq("id", inbox.channel_id)
      .maybeSingle();
    cfg = ch?.config ?? null;
  }
  if (!cfg) {
    const { data: ch } = await admin
      .from("channels")
      .select("config")
      .eq("account_id", conv.account_id)
      .eq("channel_type", "whatsapp")
      .eq("enabled", true)
      .limit(1)
      .maybeSingle();
    cfg = ch?.config ?? null;
  }
  if (!cfg?.evolution_url || !cfg?.evolution_api_key || !cfg?.evolution_instance_name) {
    return j({ error: "WhatsApp channel not configured" }, 409);
  }

  // Resolve target number: prefer phone_number, else parse from identifier evolution:whatsapp:<jid>
  let targetNumber = contact.phone_number ?? "";
  if (!targetNumber && contact.identifier) {
    const m = contact.identifier.match(/evolution:whatsapp:([^@:]+)/);
    if (m) targetNumber = m[1];
  }
  if (!targetNumber) return j({ error: "no destination number" }, 409);

  // Send via Evolution
  let providerId: string | undefined;
  try {
    const res = await sendText({
      url: cfg.evolution_url,
      apiKey: cfg.evolution_api_key,
      instanceName: cfg.evolution_instance_name,
      number: targetNumber,
      text,
    });
    providerId = res.messageId;
  } catch (e: any) {
    console.error("[chat-send-message] evolution send failed", e?.message);
    return j({ error: String(e?.message ?? e).slice(0, 500) }, 502);
  }

  // Record outbound message
  const { data: inserted, error: insErr } = await admin
    .from("messages")
    .insert({
      account_id: conv.account_id,
      inbox_id: conv.inbox_id,
      conversation_id: conv.id,
      content: text,
      message_type: 1, // outgoing
      sender_type: "User",
      sender_id: userId,
      content_type: 0,
      private: false,
      source_id: providerId ?? null,
      additional_attributes: { sent_via: "live_chat", operator: userId },
    })
    .select("id")
    .single();

  if (insErr) {
    console.error("[chat-send-message] message insert failed", insErr.message);
    return j({ error: "message_insert_failed", providerId }, 500);
  }

  // Touch conversation last activity
  await admin
    .from("conversations")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", conv.id);

  return j({ ok: true, message_id: inserted.id, provider_id: providerId });
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

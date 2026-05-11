// GDPR/LGPD: export all data we hold about a single contact.
// Input: { contact_id: uuid }
// Output: JSON bundle with contact row, conversations, messages, memory
// nodes, facts, dossier, outcomes, voice_calls.
//
// Admin-only; audited via audit_log.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import {
  authErrorResponse,
  requireAuth,
  requireContactAccess,
} from "../_shared/auth.ts";
import { loggerFor } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const log = loggerFor(req, { function: "contact-export" });

  try {
    const ctx = await requireAuth(req);
    const { contact_id } = await req.json();
    const accountId = await requireContactAccess(ctx, contact_id);

    // Admin check — listing messages + memory could be privacy-sensitive.
    const { data: role } = await ctx.adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", ctx.userId)
      .eq("account_id", accountId)
      .maybeSingle();
    if (!role || role.role !== "admin") return j({ error: "admin role required" }, 403);

    const admin = ctx.adminClient;
    const [contact, conversations, messages, memoryNodes, facts, dossier, outcomes, calls] =
      await Promise.all([
        admin.from("contacts").select("*").eq("id", contact_id).maybeSingle(),
        admin.from("conversations").select("*").eq("contact_id", contact_id),
        admin
          .from("messages")
          .select("id, conversation_id, content, content_type, sender_type, created_at, additional_attributes, content_attributes")
          .in(
            "conversation_id",
            (
              await admin.from("conversations").select("id").eq("contact_id", contact_id)
            ).data?.map((c) => c.id) ?? [],
          ),
        admin.from("customer_memory_nodes").select("*").eq("contact_id", contact_id),
        admin.from("contact_facts").select("*").eq("contact_id", contact_id),
        admin.from("contact_dossiers").select("*").eq("contact_id", contact_id).maybeSingle(),
        admin.from("conversation_outcomes").select("*").eq("contact_id", contact_id),
        admin.from("voice_calls").select("*").eq("phone_number_id", contact_id), // contact_id is loose here
      ]);

    const bundle = {
      exported_at: new Date().toISOString(),
      contact: contact.data,
      conversations: conversations.data ?? [],
      messages: messages.data ?? [],
      memory_nodes: (memoryNodes.data ?? []).map((n: any) => ({ ...n, embedding: undefined })),
      contact_facts: facts.data ?? [],
      dossier: dossier.data,
      outcomes: outcomes.data ?? [],
      voice_calls: calls.data ?? [],
    };

    await admin.from("audit_log").insert({
      account_id: accountId,
      actor_id: ctx.userId,
      entity_type: "contact",
      entity_id: contact_id,
      action: "export",
      metadata: {
        counts: {
          conversations: bundle.conversations.length,
          messages: bundle.messages.length,
          memory_nodes: bundle.memory_nodes.length,
        },
      },
    });

    log.info("contact export complete", {
      account_id: accountId,
      contact_id,
      messages: bundle.messages.length,
    });

    return new Response(JSON.stringify(bundle, null, 2), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="nexus-contact-${contact_id}.json"`,
      },
    });
  } catch (err) {
    const authed = authErrorResponse(err, corsHeaders);
    if (authed) return authed;
    log.error("export failed", err);
    return j({ error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

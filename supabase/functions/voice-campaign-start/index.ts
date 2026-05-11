// Start (or schedule) a voice campaign.
// Input: {
//   campaign_id: uuid,
//   contact_ids: string[],
//   variables_by_contact?: { [contact_id]: { key: value } }
// }
// OR with campaign object inline to create+start in one shot:
// {
//   account_id, name, persona_id?, voice_id?, phone_number_id,
//   script_mode, opening_script?, system_prompt?, escalation_rules?,
//   contact_ids, variables_by_contact?
// }
//
// Side effects:
//   - voice_campaigns row (create or flip status=running)
//   - voice_campaign_contacts rows inserted with status=queued
//   - dispatch-ready rows queued for voice-campaign-dispatch cron
//
// The dispatch itself is async (cron scans dispatch_after<=now and queued).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { loggerFor } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_CONTACTS = 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);
  const log = loggerFor(req, { function: "voice-campaign-start" });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return j({ error: "unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, service);
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: u } = await userClient.auth.getUser();
    const uid = u?.user?.id;
    if (!uid) return j({ error: "unauthorized" }, 401);

    const body = await req.json();
    let campaignId: string | undefined = body.campaign_id;
    const accountId: string = body.account_id;
    let contactIds: string[] = Array.isArray(body.contact_ids) ? body.contact_ids : [];
    const variables = (body.variables_by_contact ?? {}) as Record<string, Record<string, unknown>>;
    const testMode: boolean = body.test_mode === true;

    if (!accountId) return j({ error: "account_id required" }, 400);
    if (contactIds.length === 0) return j({ error: "contact_ids required" }, 400);
    if (contactIds.length > MAX_CONTACTS) return j({ error: `max ${MAX_CONTACTS}/campaign` }, 400);

    // F2: Test mode — limit to first 3 contacts
    if (testMode) {
      contactIds = contactIds.slice(0, 3);
    }

    // Admin check — voice costs money, restrict
    const { data: role } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", uid)
      .eq("account_id", accountId)
      .maybeSingle();
    if (!role || role.role !== "admin") return j({ error: "admin role required" }, 403);

    // Create campaign if no id passed
    if (!campaignId) {
      if (!body.name || !body.phone_number_id) {
        return j({ error: "name and phone_number_id required to create" }, 400);
      }
      // Validate phone_number_id belongs to this account
      const { data: phoneRow } = await admin
        .from("phone_numbers")
        .select("id, e164, account_id, outbound_enabled")
        .eq("id", body.phone_number_id)
        .eq("account_id", accountId)
        .maybeSingle();
      if (!phoneRow) {
        return j({ error: "phone_number_id não pertence a este workspace" }, 403);
      }
      if (!phoneRow.outbound_enabled) {
        return j({ error: "número não tem outbound habilitado — abra /phone-numbers" }, 400);
      }

      const finalName = testMode ? `[TESTE] ${body.name}` : body.name;
      const collectionConfig = body.collection_config && typeof body.collection_config === "object"
        ? body.collection_config
        : undefined;
      const quotas = body.quotas && typeof body.quotas === "object" ? body.quotas : null;
      const quotaCols: Record<string, number | null> = {};
      const quotaKeys = [
        "max_calls_per_day",
        "max_calls_per_week",
        "max_calls_per_month",
        "max_messages_per_day",
        "max_messages_per_week",
        "max_messages_per_month",
      ] as const;
      if (quotas) {
        for (const k of quotaKeys) {
          const v = (quotas as Record<string, unknown>)[k];
          if (v === null || v === undefined || v === "") quotaCols[k] = null;
          else {
            const n = Number(v);
            quotaCols[k] = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
          }
        }
      }
      const { data: created, error } = await admin
        .from("voice_campaigns")
        .insert({
          account_id: accountId,
          name: finalName,
          description: body.description,
          persona_id: body.persona_id,
          voice_id: body.voice_id,
          language_code: body.language_code ?? "pt-BR",
          script_mode: body.script_mode ?? "conversational",
          opening_script: body.opening_script,
          system_prompt: body.system_prompt,
          phone_number_id: body.phone_number_id,
          from_number: phoneRow.e164,
          escalation_rules: body.escalation_rules ?? [],
          max_call_duration_sec: body.max_call_duration_sec ?? 300,
          voicemail_detection: body.voicemail_detection ?? true,
          record_call: body.record_call ?? true,
          triggered_by_id: uid,
          created_by_id: uid,
          status: body.scheduled_for ? "scheduled" : "running",
          scheduled_for: body.scheduled_for,
          started_at: body.scheduled_for ? null : new Date().toISOString(),
          contact_count: contactIds.length,
          total_contacts: contactIds.length,
          test_mode: testMode,
          campaign_kind: "collection",
          ...(collectionConfig ? { collection_config: collectionConfig } : {}),
          ...quotaCols,
        })
        .select()
        .single();
      if (error) return j({ error: `campaign insert failed: ${error.message}` }, 500);
      campaignId = created.id;
    } else {
      // Flip existing draft to running
      await admin
        .from("voice_campaigns")
        .update({
          status: "running",
          started_at: new Date().toISOString(),
          contact_count: contactIds.length,
          total_contacts: contactIds.length,
        })
        .eq("id", campaignId)
        .eq("account_id", accountId);
    }

    // Fetch contacts we actually own + are in the target list
    const { data: ownedContacts } = await admin
      .from("contacts")
      .select("id, phone_number, name")
      .eq("account_id", accountId)
      .in("id", contactIds)
      .not("phone_number", "is", null);

    const rows = (ownedContacts ?? [])
      .filter((c) => c.phone_number)
      .map((c) => ({
        campaign_id: campaignId,
        account_id: accountId,
        contact_id: c.id,
        phone_number: c.phone_number!,
        to_number: c.phone_number!,
        variables: variables[c.id] ?? {},
        status: "queued" as const,
        dispatch_after: new Date().toISOString(),
      }));

    if (rows.length === 0) return j({ error: "no contacts with phone_number" }, 400);

    const { error: insErr } = await admin
      .from("voice_campaign_contacts")
      .upsert(rows, { onConflict: "campaign_id,contact_id", ignoreDuplicates: true });
    if (insErr) return j({ error: insErr.message }, 500);

    log.info("campaign started", {
      account_id: accountId,
      campaign_id: campaignId,
      queued: rows.length,
    });

    return j({ campaign_id: campaignId, queued: rows.length, skipped: contactIds.length - rows.length });
  } catch (err) {
    log.error("start failed", err);
    return j({ error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

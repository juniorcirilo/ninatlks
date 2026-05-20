// Cron — varre voice_calls recentes com outcome 'prometeu_pagar' e
// cria registros em promise_followups (D+3 após a promessa).
// Também enfileira followups vencidos em voice_campaign_contacts da
// campanha de cobrança configurada na campanha original (metadata.followup_campaign_id)
// ou na primeira campanha do account com campaign_kind='cobranca'.
//
// Roda a cada 1h.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const j = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const isService = (req.headers.get("Authorization") ?? "").includes(serviceKey);
  const isCron = req.headers.get("apikey") === Deno.env.get("SUPABASE_ANON_KEY");
  if (!isService && !isCron) return j({ error: "service role required" }, 403);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  // ─── PHASE 1: detect new promises ─────────────────────────────────
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: promiseCalls } = await admin
    .from("voice_calls")
    .select("id, account_id, metadata, started_at, ended_at, conversation_id")
    .eq("outcome_category", "prometeu_pagar")
    .gte("outcome_classified_at", since);

  let detected = 0;
  for (const call of promiseCalls ?? []) {
    const meta = (call.metadata ?? {}) as Record<string, unknown>;
    const campaignId = (meta.campaign_id as string) ?? null;
    const contactId = (meta.contact_id as string) ?? null;
    if (!contactId) continue;

    // Already tracked?
    const { data: existing } = await admin
      .from("promise_followups")
      .select("id")
      .eq("source_call_id", call.id)
      .maybeSingle();
    if (existing) continue;

    // Promise due date: from metadata if present, else D+3 from ended_at
    const promisedDateStr =
      (meta.promised_due_date as string) ??
      new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
    const followupAt = new Date(new Date(promisedDateStr).getTime() + 86400_000).toISOString();

    await admin.from("promise_followups").insert({
      account_id: call.account_id,
      contact_id: contactId,
      source_call_id: call.id,
      source_campaign_id: campaignId,
      promised_amount: (meta.promised_amount as number) ?? null,
      promised_due_date: promisedDateStr,
      followup_at: followupAt,
      status: "pending",
    });
    detected++;
  }

  // ─── PHASE 2: enroll due followups in cobranca campaign ────────────
  const nowIso = new Date().toISOString();
  const { data: due } = await admin
    .from("promise_followups")
    .select("id, account_id, contact_id, source_campaign_id, promised_amount, promised_due_date")
    .eq("status", "pending")
    .lte("followup_at", nowIso)
    .limit(100);

  let enrolled = 0;
  for (const p of due ?? []) {
    // Resolve target campaign: prefer same campaign; else first running cobranca campaign
    let targetCampaign = p.source_campaign_id as string | null;
    if (!targetCampaign) {
      const { data: c } = await admin
        .from("voice_campaigns")
        .select("id")
        .eq("account_id", p.account_id)
        .eq("campaign_kind", "cobranca")
        .in("status", ["running", "draft"])
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      targetCampaign = c?.id ?? null;
    }
    if (!targetCampaign) continue;

    const { data: contact } = await admin
      .from("contacts")
      .select("phone_number, blocked")
      .eq("id", p.contact_id)
      .maybeSingle();
    if (!contact?.phone_number || contact.blocked) {
      await admin.from("promise_followups").update({ status: "cancelled" }).eq("id", p.id);
      continue;
    }

    const { error: insErr } = await admin.from("voice_campaign_contacts").insert({
      campaign_id: targetCampaign,
      account_id: p.account_id,
      contact_id: p.contact_id,
      phone_number: contact.phone_number,
      status: "queued",
      dispatch_after: new Date().toISOString(),
      variables: {
        followup_kind: "promise_check",
        promised_amount: p.promised_amount,
        promised_due_date: p.promised_due_date,
      },
    });
    if (insErr) continue;

    await admin
      .from("promise_followups")
      .update({ status: "enrolled", followup_campaign_id: targetCampaign })
      .eq("id", p.id);
    enrolled++;
  }

  return j({ ok: true, detected, enrolled });
});

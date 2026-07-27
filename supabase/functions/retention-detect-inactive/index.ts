// Cron — detecta contatos inativos (sem last_activity_at por X dias)
// e enfileira em voice_campaign_contacts da campanha de retenção da regra.
//
// Trigger: pg_cron 0 13 * * * (10h BRT, diário). Service role only.

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

  const { data: rules, error } = await admin
    .from("retention_rules")
    .select("*")
    .eq("enabled", true);
  if (error) return j({ error: error.message }, 500);

  let totalEnrolled = 0;
  const ruleResults: Array<{ rule_id: string; enrolled: number; reason?: string }> = [];

  for (const rule of rules ?? []) {
    if (!rule.target_campaign_id) {
      ruleResults.push({ rule_id: rule.id, enrolled: 0, reason: "no_target_campaign" });
      continue;
    }

    const cutoff = new Date(Date.now() - rule.inactive_days * 86400_000).toISOString();

    // Find inactive contacts
    let q = admin
      .from("contacts")
      .select("id, phone_number")
      .eq("account_id", rule.account_id)
      .eq("blocked", false)
      .not("phone_number", "is", null)
      .or(`last_activity_at.is.null,last_activity_at.lte.${cutoff}`)
      .limit(rule.max_enrolls_per_run);

    if (rule.required_stage_id) q = q.eq("stage_id", rule.required_stage_id);

    const { data: candidates, error: cErr } = await q;
    if (cErr) {
      ruleResults.push({ rule_id: rule.id, enrolled: 0, reason: cErr.message });
      continue;
    }

    if (!candidates || candidates.length === 0) {
      await admin
        .from("retention_rules")
        .update({ last_run_at: new Date().toISOString(), last_enrolled_count: 0 })
        .eq("id", rule.id);
      ruleResults.push({ rule_id: rule.id, enrolled: 0, reason: "no_candidates" });
      continue;
    }

    // Skip contacts already enrolled (any status) in this campaign
    const ids = candidates.map((c) => c.id);
    const { data: existing } = await admin
      .from("voice_campaign_contacts")
      .select("contact_id")
      .eq("campaign_id", rule.target_campaign_id)
      .in("contact_id", ids);
    const enrolled = new Set((existing ?? []).map((e) => e.contact_id));

    const toEnroll = candidates
      .filter((c) => !enrolled.has(c.id) && c.phone_number)
      .map((c) => ({
        campaign_id: rule.target_campaign_id,
        account_id: rule.account_id,
        contact_id: c.id,
        phone_number: c.phone_number,
        status: "queued",
        dispatch_after: new Date().toISOString(),
      }));

    if (toEnroll.length === 0) {
      await admin
        .from("retention_rules")
        .update({ last_run_at: new Date().toISOString(), last_enrolled_count: 0 })
        .eq("id", rule.id);
      ruleResults.push({ rule_id: rule.id, enrolled: 0, reason: "all_already_enrolled" });
      continue;
    }

    const { error: iErr } = await admin.from("voice_campaign_contacts").insert(toEnroll);
    if (iErr) {
      ruleResults.push({ rule_id: rule.id, enrolled: 0, reason: iErr.message });
      continue;
    }

    await admin
      .from("retention_rules")
      .update({ last_run_at: new Date().toISOString(), last_enrolled_count: toEnroll.length })
      .eq("id", rule.id);

    // Bump total_contacts on campaign
    await admin.rpc("increment_campaign_contact_count", {
      p_campaign_id: rule.target_campaign_id,
      p_delta: toEnroll.length,
    }).catch(() => {
      // Fallback: best-effort raw update
      return admin
        .from("voice_campaigns")
        .update({ total_contacts: 0 })
        .eq("id", rule.target_campaign_id);
    });

    totalEnrolled += toEnroll.length;
    ruleResults.push({ rule_id: rule.id, enrolled: toEnroll.length });
  }

  return j({ ok: true, total_enrolled: totalEnrolled, rules: ruleResults });
});

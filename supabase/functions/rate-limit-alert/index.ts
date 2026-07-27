// Every 10 min, scan channel_usage_metrics for accounts whose Meta API usage
// crossed 80% in the last hour, and insert a notification so ops/admins see
// it before Meta throttles outbound traffic.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { loggerFor } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const THRESHOLD_PCT = 80;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const log = loggerFor(req, { function: "rate-limit-alert" });
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const isService = (req.headers.get("Authorization") ?? "").includes(serviceKey);
  if (!isService) return json({ error: "service role required" }, 403);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from("channel_usage_metrics")
    .select("account_id, channel_id, product_kind, total_time_pct, total_cputime_pct, call_volume_pct, bucket_hour")
    .gte("bucket_hour", since)
    .or(
      `total_time_pct.gte.${THRESHOLD_PCT},total_cputime_pct.gte.${THRESHOLD_PCT},call_volume_pct.gte.${THRESHOLD_PCT}`,
    );
  if (error) {
    log.error("usage scan failed", error);
    return json({ error: error.message }, 500);
  }

  // Deduplicate: at most one alert per (account, product) per 60 min.
  const seen = new Set<string>();
  let inserted = 0;
  for (const r of rows ?? []) {
    const key = `${r.account_id}:${r.product_kind}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const peak = Math.max(
      r.total_time_pct ?? 0,
      r.total_cputime_pct ?? 0,
      r.call_volume_pct ?? 0,
    );

    // Find an admin to notify.
    const { data: admin } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("account_id", r.account_id)
      .eq("role", "admin")
      .limit(1)
      .maybeSingle();
    if (!admin) continue;

    // Skip if identical notification already issued in the last hour.
    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("account_id", r.account_id)
      .eq("user_id", admin.user_id)
      .eq("kind", "rate_limit_alert")
      .gte("created_at", since);
    if ((count ?? 0) > 0) continue;

    await supabase.from("notifications").insert({
      account_id: r.account_id,
      user_id: admin.user_id,
      kind: "rate_limit_alert",
      title: `Meta API ${r.product_kind}: ${peak}% do limite`,
      body: "Taxa de uso >= 80%. Considere reduzir volume de disparo ou escalar mais números.",
      link_to: "/platform-health",
      metadata: {
        product_kind: r.product_kind,
        peak_pct: peak,
        bucket_hour: r.bucket_hour,
      },
    });
    inserted++;
  }

  log.info("alert tick", { inserted, candidates: rows?.length ?? 0 });
  return json({ inserted, scanned: rows?.length ?? 0 });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

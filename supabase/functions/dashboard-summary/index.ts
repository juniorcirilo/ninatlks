// Returns aggregated counters for the dashboard.
// Requires JWT (uses caller's RLS) — accepts ?accountId or infers from first membership.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const accountId = url.searchParams.get("accountId");
    if (!accountId) {
      return new Response(JSON.stringify({ error: "accountId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();
    const last30 = new Date(Date.now() - 30 * 86400_000).toISOString();
    const last24 = new Date(Date.now() - 24 * 3600_000).toISOString();

    const [
      open,
      pending,
      resolvedToday,
      unattended,
      totalContacts,
      totalInboxes,
      personas,
      activeDeployments,
      memoryNodes,
      outcomes30d,
      incidentsActive,
      calls24h,
    ] = await Promise.all([
      supabase.from("conversations").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("status", 0),
      supabase.from("conversations").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("status", 2),
      supabase.from("conversations").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("status", 1).gte("updated_at", todayIso),
      supabase.from("conversations").select("id", { count: "exact", head: true }).eq("account_id", accountId).is("first_reply_created_at", null).eq("status", 0),
      supabase.from("contacts").select("id", { count: "exact", head: true }).eq("account_id", accountId),
      supabase.from("inboxes").select("id", { count: "exact", head: true }).eq("account_id", accountId),
      supabase.from("agent_personas").select("id", { count: "exact", head: true }).eq("account_id", accountId),
      supabase.from("agent_persona_deployments").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("enabled", true),
      supabase.from("customer_memory_nodes").select("id", { count: "exact", head: true }).eq("account_id", accountId),
      supabase.from("conversation_outcomes").select("id", { count: "exact", head: true }).eq("account_id", accountId).gte("observed_at", last30),
      supabase.from("incident_clusters").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("status", "detected"),
      supabase.from("voice_calls").select("id", { count: "exact", head: true }).eq("account_id", accountId).gte("created_at", last24),
    ]);

    return new Response(
      JSON.stringify({
        conversations: {
          open: open.count ?? 0,
          pending: pending.count ?? 0,
          resolvedToday: resolvedToday.count ?? 0,
          unattended: unattended.count ?? 0,
          totalContacts: totalContacts.count ?? 0,
          totalInboxes: totalInboxes.count ?? 0,
        },
        engine: {
          personas: personas.count ?? 0,
          activeDeployments: activeDeployments.count ?? 0,
          memoryNodes: memoryNodes.count ?? 0,
          outcomesLast30d: outcomes30d.count ?? 0,
          incidentsActive: incidentsActive.count ?? 0,
          callsLast24h: calls24h.count ?? 0,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[dashboard-summary] error", err);
    return new Response(JSON.stringify({ error: String((err as Error).message ?? err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Returns recent activity feed (mixed: messages, outcomes, signals, incidents).
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
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "10"), 50);
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

    const [outcomes, incidents, signals] = await Promise.all([
      supabase.from("conversation_outcomes").select("id, outcome_type, value, observed_at, conversation_id").eq("account_id", accountId).order("observed_at", { ascending: false }).limit(limit),
      supabase.from("incident_clusters").select("id, title, severity, status, last_seen_at").eq("account_id", accountId).order("last_seen_at", { ascending: false }).limit(limit),
      supabase.from("conversation_signals").select("id, kind, severity, detected_at, conversation_id").eq("account_id", accountId).gte("severity", 0.5).order("detected_at", { ascending: false }).limit(limit),
    ]);

    const items: Array<{ kind: string; at: string; label: string; color: string; refId?: string }> = [];

    (outcomes.data ?? []).forEach((o: any) => {
      items.push({
        kind: "outcome",
        at: o.observed_at,
        label: `Resultado registrado: ${o.outcome_type}${o.value ? ` (R$ ${o.value})` : ""}`,
        color: "emerald",
        refId: o.conversation_id,
      });
    });
    (incidents.data ?? []).forEach((i: any) => {
      items.push({
        kind: "incident",
        at: i.last_seen_at,
        label: `Incidente ${i.severity}: ${i.title}`,
        color: i.severity === "high" ? "rose" : i.severity === "medium" ? "amber" : "sky",
      });
    });
    (signals.data ?? []).forEach((s: any) => {
      items.push({
        kind: "signal",
        at: s.detected_at,
        label: `Sinal crítico: ${s.kind} (${(s.severity * 100).toFixed(0)}%)`,
        color: "violet",
        refId: s.conversation_id,
      });
    });

    items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    return new Response(JSON.stringify({ activity: items.slice(0, limit) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[recent-activity] error", err);
    return new Response(JSON.stringify({ error: String((err as Error).message ?? err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

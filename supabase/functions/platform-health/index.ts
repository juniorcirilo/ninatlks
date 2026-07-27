// Returns platform health: API key presence, worker status, account counts.
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

    const env = {
      LOVABLE_API_KEY: !!Deno.env.get("LOVABLE_API_KEY"),
      ANTHROPIC_API_KEY: !!Deno.env.get("ANTHROPIC_API_KEY"),
      OPENAI_API_KEY: !!Deno.env.get("OPENAI_API_KEY"),
      DEEPGRAM_API_KEY: !!Deno.env.get("DEEPGRAM_API_KEY"),
      ELEVENLABS_API_KEY: !!Deno.env.get("ELEVENLABS_API_KEY"),
      TWILIO_ACCOUNT_SID: !!Deno.env.get("TWILIO_ACCOUNT_SID"),
      TWILIO_AUTH_TOKEN: !!Deno.env.get("TWILIO_AUTH_TOKEN"),
      WIDGET_TOKEN_SECRET: !!Deno.env.get("WIDGET_TOKEN_SECRET"),
    };

    const hasLlm = env.LOVABLE_API_KEY || env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY;
    const hasVoice = env.DEEPGRAM_API_KEY && env.ELEVENLABS_API_KEY && env.TWILIO_ACCOUNT_SID;

    const workers = {
      memoryExtractor: { enabled: hasLlm, label: "Extrator de memória" },
      signalDetector: { enabled: true, label: "Detector de sinais subtextuais" },
      incidentClusterer: { enabled: hasLlm, label: "Agrupador de incidentes" },
      improvementLoop: { enabled: hasLlm, label: "Loop de auto-melhoria (1h)" },
      voiceRuntime: { enabled: hasVoice, label: "Runtime de voz" },
    };

    let counts: Record<string, number> = {};
    if (accountId) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: auth } } },
      );

      const last30 = new Date(Date.now() - 30 * 86400_000).toISOString();
      const last24 = new Date(Date.now() - 24 * 3600_000).toISOString();

      const [personas, deployments, memNodes, outcomes, incidents, calls] = await Promise.all([
        supabase.from("agent_personas").select("id", { count: "exact", head: true }).eq("account_id", accountId),
        supabase.from("agent_persona_deployments").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("enabled", true),
        supabase.from("customer_memory_nodes").select("id", { count: "exact", head: true }).eq("account_id", accountId),
        supabase.from("conversation_outcomes").select("id", { count: "exact", head: true }).eq("account_id", accountId).gte("observed_at", last30),
        supabase.from("incident_clusters").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("status", "detected"),
        supabase.from("voice_calls").select("id", { count: "exact", head: true }).eq("account_id", accountId).gte("created_at", last24),
      ]);

      counts = {
        personas: personas.count ?? 0,
        activeDeployments: deployments.count ?? 0,
        memoryNodes: memNodes.count ?? 0,
        outcomesLast30d: outcomes.count ?? 0,
        incidentsActive: incidents.count ?? 0,
        callsLast24h: calls.count ?? 0,
      };
    }

    return new Response(
      JSON.stringify({
        version: Deno.env.get("BUILD_SHA") ?? "dev",
        env,
        workers,
        counts,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[platform-health] error", err);
    return new Response(JSON.stringify({ error: String((err as Error).message ?? err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

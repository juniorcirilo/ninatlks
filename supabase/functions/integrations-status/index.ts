// Single endpoint that answers "is my stack set up?" for the Integrations
// tab in /settings. Pings each external API with the configured key and
// returns status + usage summary.
//
// Called by: src/routes/_authenticated/settings.tsx (Integrações tab)
// verify_jwt = false; caller must be admin of the requested account.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { resolveSecret, resolveSecretsBulk } from "../_shared/secrets/vault.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ProviderStatus {
  key: string;              // "elevenlabs" | "twilio" | "evolution" | "deepgram"
  label: string;
  configured: boolean;      // env var(s) present?
  ok: boolean | null;       // API ping succeeded? null = not tested (missing key)
  detail?: string;          // human-readable status or error
  usage?: Record<string, string | number | null>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return j({ error: "unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) return j({ error: "unauthorized" }, 401);

  let body: { account_id: string };
  try { body = await req.json(); } catch { return j({ error: "body must be JSON" }, 400); }
  if (!body.account_id) return j({ error: "account_id required" }, 400);

  const { data: role } = await admin
    .from("user_roles").select("role")
    .eq("user_id", u.user.id).eq("account_id", body.account_id)
    .maybeSingle();
  if (!role || role.role !== "admin") return j({ error: "admin role required" }, 403);

  const providers = await Promise.all([
    checkElevenLabs(admin, body.account_id),
    checkTwilio(admin, body.account_id),
    checkEvolution(admin, body.account_id),
    checkDeepgram(admin, body.account_id),
  ]);

  // Nexus-specific readiness: has an agent? has a number? IA ativada?
  const [{ data: personas }, { data: numbers }] = await Promise.all([
    admin.from("agent_personas")
      .select("id, elevenlabs_agent_id").eq("account_id", body.account_id),
    admin.from("phone_numbers")
      .select("id, elevenlabs_phone_number_id, pinned_persona_id")
      .eq("account_id", body.account_id),
  ]);
  const agents = (personas ?? []) as any[];
  const nums = (numbers ?? []) as any[];
  const agentsSynced = agents.filter((p) => !!p.elevenlabs_agent_id).length;
  const numbersWithAi = nums.filter((n) => !!n.elevenlabs_phone_number_id).length;

  return j({
    ok: true,
    providers,
    nexus: {
      agents_total: agents.length,
      agents_synced_to_el: agentsSynced,
      numbers_total: nums.length,
      numbers_ai_active: numbersWithAi,
      numbers_pinned: nums.filter((n) => !!n.pinned_persona_id).length,
    },
  });
});

// ─── Provider checks ──────────────────────────────────────────────────

async function checkElevenLabs(admin: any, accountId: string): Promise<ProviderStatus> {
  const key = await resolveSecret(admin, {
    accountId,
    provider: "elevenlabs",
    keyName: "api_key",
    envVar: "ELEVENLABS_API_KEY",
    noCache: true,
  });
  if (!key) return { key: "elevenlabs", label: "ElevenLabs (voz)", configured: false, ok: null };
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
      headers: { "xi-api-key": key },
    });
    if (!res.ok) return { key: "elevenlabs", label: "ElevenLabs (voz)", configured: true, ok: false, detail: `HTTP ${res.status}` };
    const sub = await res.json() as any;
    const used = sub?.character_count ?? 0;
    const limit = sub?.character_limit ?? 0;
    const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
    const tier = sub?.tier ?? "free";
    return {
      key: "elevenlabs",
      label: "ElevenLabs (voz)",
      configured: true,
      ok: true,
      detail: `Plano ${tier} · ${pct}% usado`,
      usage: {
        plano: tier,
        caracteres_usados: used,
        caracteres_limite: limit,
        percentual: `${pct}%`,
      },
    };
  } catch (err) {
    return { key: "elevenlabs", label: "ElevenLabs", configured: true, ok: false, detail: String(err).slice(0, 120) };
  }
}

async function checkTwilio(admin: any, accountId: string): Promise<ProviderStatus> {
  const creds = await resolveSecretsBulk(admin, {
    accountId,
    provider: "twilio",
    keys: [
      { keyName: "account_sid", envVar: "TWILIO_ACCOUNT_SID" },
      { keyName: "auth_token", envVar: "TWILIO_AUTH_TOKEN" },
    ],
  });
  const sid = creds.account_sid ?? "";
  const token = creds.auth_token ?? "";
  if (!sid || !token) return { key: "twilio", label: "Twilio (telefonia)", configured: false, ok: null };
  try {
    const auth = `Basic ${btoa(`${sid}:${token}`)}`;
    const [balanceRes, numbersRes] = await Promise.all([
      fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Balance.json`, {
        headers: { Authorization: auth },
      }),
      fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=1`, {
        headers: { Authorization: auth },
      }),
    ]);
    if (!balanceRes.ok) return { key: "twilio", label: "Twilio (telefonia)", configured: true, ok: false, detail: `HTTP ${balanceRes.status}` };
    const balance = await balanceRes.json() as any;
    const numbers = await numbersRes.json().catch(() => ({})) as any;
    const bal = parseFloat(balance?.balance ?? "0");
    const currency = balance?.currency ?? "USD";
    return {
      key: "twilio",
      label: "Twilio (telefonia)",
      configured: true,
      ok: true,
      detail: `Saldo: ${currency} ${bal.toFixed(2)}${bal < 5 ? " ⚠️ baixo" : ""}`,
      usage: {
        saldo: `${currency} ${bal.toFixed(2)}`,
        numeros: numbers?.meta?.total ?? numbers?.incoming_phone_numbers?.length ?? 0,
      },
    };
  } catch (err) {
    return { key: "twilio", label: "Twilio", configured: true, ok: false, detail: String(err).slice(0, 120) };
  }
}

async function checkDeepgram(admin: any, accountId: string): Promise<ProviderStatus> {
  const key = await resolveSecret(admin, {
    accountId,
    provider: "deepgram",
    keyName: "api_key",
    envVar: "DEEPGRAM_API_KEY",
    noCache: true,
  });
  if (!key) return { key: "deepgram", label: "Deepgram (transcrição)", configured: false, ok: null };
  try {
    // /v1/projects requires a valid key; returns 401 if invalid.
    const res = await fetch("https://api.deepgram.com/v1/projects", {
      headers: { Authorization: `Token ${key}` },
    });
    if (!res.ok) {
      return { key: "deepgram", label: "Deepgram (transcrição)", configured: true, ok: false, detail: `HTTP ${res.status}` };
    }
    const body = await res.json().catch(() => ({})) as any;
    const projects = Array.isArray(body?.projects) ? body.projects.length : 0;
    return {
      key: "deepgram",
      label: "Deepgram (transcrição)",
      configured: true,
      ok: true,
      detail: `${projects} projeto${projects === 1 ? "" : "s"} acessível${projects === 1 ? "" : "s"}`,
      usage: { projetos: projects },
    };
  } catch (err) {
    return { key: "deepgram", label: "Deepgram", configured: true, ok: false, detail: String(err).slice(0, 120) };
  }
}

async function checkEvolution(admin: any, accountId: string): Promise<ProviderStatus> {
  // Evolution is per-account — URL + key live on the whatsapp channel row.
  const { data: channel } = await admin
    .from("channels")
    .select("config, enabled")
    .eq("account_id", accountId)
    .eq("channel_type", "whatsapp")
    .maybeSingle();
  const cfg = (channel?.config ?? {}) as Record<string, string>;
  if (!cfg.evolution_url || !cfg.evolution_api_key) {
    return { key: "evolution", label: "Evolution (WhatsApp Web)", configured: false, ok: null };
  }
  try {
    const res = await fetch(`${cfg.evolution_url.replace(/\/$/, "")}/instance/fetchInstances`, {
      headers: { apikey: cfg.evolution_api_key },
    });
    if (!res.ok) return { key: "evolution", label: "Evolution (WhatsApp Web)", configured: true, ok: false, detail: `HTTP ${res.status}` };
    const list = await res.json().catch(() => []);
    const total = Array.isArray(list) ? list.length : 0;
    const connected = Array.isArray(list)
      ? list.filter((i: any) =>
          (i?.connectionStatus ?? i?.instance?.state ?? "").toString().includes("open"),
        ).length
      : 0;
    return {
      key: "evolution",
      label: "Evolution (WhatsApp Web)",
      configured: true,
      ok: true,
      detail: `${connected}/${total} conectada(s) · status: ${cfg.evolution_instance_status ?? "?"}`,
      usage: {
        instancias_total: total,
        instancias_conectadas: connected,
      },
    };
  } catch (err) {
    return { key: "evolution", label: "Evolution", configured: true, ok: false, detail: String(err).slice(0, 120) };
  }
}

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

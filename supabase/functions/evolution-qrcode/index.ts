// Fetch a fresh QR code for an already-provisioned Evolution instance.
// The UI polls this while the dialog is open so the operator can pair
// their phone. Returns base64 PNG ready to drop into an <img src=...>.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { getQrCode } from "../_shared/evolution/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return j({ error: "unauthorized" }, 401);

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: u } = await userClient.auth.getUser();
  const uid = u?.user?.id;
  if (!uid) return j({ error: "unauthorized" }, 401);

  let body: { channel_id: string };
  try {
    body = await req.json();
  } catch {
    return j({ error: "body must be JSON" }, 400);
  }
  if (!body.channel_id) return j({ error: "channel_id required" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: channel } = await admin
    .from("channels")
    .select("id, account_id, config")
    .eq("id", body.channel_id)
    .maybeSingle();
  if (!channel) return j({ error: "channel not found" }, 404);

  const { data: role } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", uid)
    .eq("account_id", channel.account_id)
    .maybeSingle();
  if (!role || role.role !== "admin") return j({ error: "admin role required" }, 403);

  const cfg = (channel.config ?? {}) as Record<string, string>;
  if (!cfg.evolution_url || !cfg.evolution_api_key || !cfg.evolution_instance_name) {
    return j({ error: "channel not provisioned for Evolution" }, 409);
  }

  try {
    const qr = await getQrCode({
      url: cfg.evolution_url,
      apiKey: cfg.evolution_api_key,
      instanceName: cfg.evolution_instance_name,
    });
    return j({
      base64: qr.base64 ?? null,
      pairingCode: qr.pairingCode ?? null,
      code: qr.code ?? null,
    });
  } catch (e) {
    return j({ error: errMsg(e) }, 502);
  }
});

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

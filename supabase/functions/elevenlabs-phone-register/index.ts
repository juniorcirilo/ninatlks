// Register a Twilio phone number with ElevenLabs native integration and
// assign it to an agent. After this runs:
//   - EL has its own handle on the number (phnum_…)
//   - EL rewrites the Twilio Voice webhook to api.elevenlabs.io/twilio/inbound_call
//   - Inbound + outbound calls go through EL's full stack (STT, LLM, TTS, RAG)
//
// This replaces the custom twilio-incoming → signed_url approach that kept
// dropping with error 31921 — EL's convai WS is NOT compatible with Twilio
// Media Streams directly; you must go through their native phone_number API.
//
// Input: { phone_number_id (our id) } — we read e164 + pinned persona +
// Twilio creds from env/DB.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { resolveSecret, resolveSecretsBulk } from "../_shared/secrets/vault.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EL_BASE = "https://api.elevenlabs.io";

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

  let body: { phone_number_id: string };
  try {
    body = await req.json();
  } catch {
    return j({ error: "body must be JSON" }, 400);
  }
  if (!body.phone_number_id) return j({ error: "phone_number_id required" }, 400);

  const { data: pn, error: pnErr } = await admin
    .from("phone_numbers")
    .select("id, account_id, e164, friendly_name, pinned_persona_id, elevenlabs_phone_number_id, provider_config")
    .eq("id", body.phone_number_id)
    .maybeSingle();
  if (pnErr || !pn) return j({ error: "phone number not found" }, 404);

  // Authz: caller is admin of the phone's account.
  const { data: role } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", u.user.id)
    .eq("account_id", pn.account_id)
    .maybeSingle();
  if (!role || role.role !== "admin") return j({ error: "admin role required" }, 403);

  const elApiKey = await resolveSecret(admin, {
    accountId: pn.account_id,
    provider: "elevenlabs",
    keyName: "api_key",
    envVar: "ELEVENLABS_API_KEY",
  });
  if (!elApiKey) return j({ error: "ELEVENLABS_API_KEY not configured for this account" }, 500);

  const twilioCreds = await resolveSecretsBulk(admin, {
    accountId: pn.account_id,
    provider: "twilio",
    keys: [
      { keyName: "account_sid", envVar: "TWILIO_ACCOUNT_SID" },
      { keyName: "auth_token", envVar: "TWILIO_AUTH_TOKEN" },
    ],
  });
  const twilioSid = twilioCreds.account_sid ?? "";
  const twilioToken = twilioCreds.auth_token ?? "";
  if (!twilioSid || !twilioToken) {
    return j({ error: "Twilio credentials not configured for this account" }, 500);
  }

  // Resolve the agent to assign. Must be a persona already synced to EL.
  let agentId: string | null = null;
  if (pn.pinned_persona_id) {
    const { data: persona } = await admin
      .from("agent_personas")
      .select("elevenlabs_agent_id")
      .eq("id", pn.pinned_persona_id)
      .maybeSingle();
    agentId = (persona?.elevenlabs_agent_id as string | null) ?? null;
  }
  if (!agentId) {
    return j(
      {
        error: "pinned persona must have an ElevenLabs agent (click 'Sincronizar com EL' on the agent first)",
      },
      409,
    );
  }

  // Step 1: create (or re-use) the EL phone number. If already exists with
  // a different id on our side, this will fail — operator needs to delete
  // on EL first.
  let elPhoneId = pn.elevenlabs_phone_number_id as string | null;
  if (!elPhoneId) {
    const createRes = await fetch(`${EL_BASE}/v1/convai/phone-numbers/create`, {
      method: "POST",
      headers: { "xi-api-key": elApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        phone_number: pn.e164,
        label: pn.friendly_name ?? `Nexus ${pn.e164}`,
        provider: "twilio",
        sid: twilioSid,
        token: twilioToken,
      }),
    });
    if (!createRes.ok) {
      const text = await createRes.text().catch(() => "");
      return j(
        { error: `EL phone create failed: ${createRes.status}: ${text.slice(0, 300)}` },
        502,
      );
    }
    const created = await createRes.json();
    elPhoneId = created.phone_number_id as string;
    console.log(`[el-phone-register] created phnum=${elPhoneId} e164=${pn.e164}`);
  }

  // Step 2: assign the agent to the phone number.
  const patchRes = await fetch(`${EL_BASE}/v1/convai/phone-numbers/${elPhoneId}`, {
    method: "PATCH",
    headers: { "xi-api-key": elApiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ agent_id: agentId }),
  });
  if (!patchRes.ok) {
    const text = await patchRes.text().catch(() => "");
    return j(
      { error: `EL phone assign failed: ${patchRes.status}: ${text.slice(0, 300)}` },
      502,
    );
  }

  // Step 3: mirror to our DB + refresh provider_config.
  const newConfig = {
    ...((pn.provider_config as Record<string, any>) ?? {}),
    elevenlabs_phone_number_id: elPhoneId,
    elevenlabs_agent_id: agentId,
  };
  await admin
    .from("phone_numbers")
    .update({
      elevenlabs_phone_number_id: elPhoneId,
      provider_config: newConfig,
    })
    .eq("id", pn.id);

  console.log(
    `[el-phone-register] ok phone=${pn.id} el_phone=${elPhoneId} agent=${agentId}`,
  );

  return j({
    ok: true,
    phone_number_id: pn.id,
    elevenlabs_phone_number_id: elPhoneId,
    elevenlabs_agent_id: agentId,
  });
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

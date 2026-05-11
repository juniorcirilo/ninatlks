// Purchase a phone number on Twilio and register it in phone_numbers.
// Input: { account_id, phone_number, friendly_name?, inbox_id?, pinned_persona_id?,
//          inbound_behavior?, bundle_sid?, address_sid? }
//
// Side-effects:
//   1. POST /IncomingPhoneNumbers with voice_url + sms_url pre-configured to
//      twilio-incoming / twilio-sms-incoming (tenant-routed by E.164)
//   2. Insert row in phone_numbers with provider_config.twilio_sid
//   3. Audit trail in twilio_number_provisioning

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import {
  loadAccountTwilioCreds,
  numbers as twilioNumbers,
  TwilioConfigError,
} from "../_shared/twilio/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return j({ error: "unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const uid = userRes?.user?.id;
    if (!uid) return j({ error: "unauthorized" }, 401);

    const input = await req.json();
    const accountId: string | undefined = input.account_id;
    const phoneNumber: string | undefined = input.phone_number;
    if (!accountId || !phoneNumber) return j({ error: "account_id and phone_number required" }, 400);

    // Admin role required to spend money.
    const { data: role } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", uid)
      .eq("account_id", accountId)
      .maybeSingle();
    if (!role || role.role !== "admin") return j({ error: "admin role required" }, 403);

    const nexusBase = (Deno.env.get("NEXUS_PUBLIC_URL") ?? Deno.env.get("SUPABASE_URL") ?? "").replace(
      /\/$/,
      "",
    );
    const voiceUrl = `${nexusBase}/functions/v1/twilio-incoming`;
    const smsUrl = `${nexusBase}/functions/v1/twilio-sms-incoming`;
    const statusCallback = `${nexusBase}/functions/v1/twilio-status`;

    const creds = await loadAccountTwilioCreds(admin, accountId);

    let bought;
    try {
      bought = await twilioNumbers.buyNumber(creds, {
        phoneNumber,
        friendlyName: input.friendly_name ?? `Nexus ${phoneNumber}`,
        voiceUrl,
        voiceMethod: "POST",
        smsUrl,
        smsMethod: "POST",
        statusCallback,
        bundleSid: input.bundle_sid,
        addressSid: input.address_sid,
      });
    } catch (err) {
      await admin.from("twilio_number_provisioning").insert({
        account_id: accountId,
        e164: phoneNumber,
        action: "buy",
        request: input,
        response: { error: String(err) },
        http_status: 502,
        triggered_by_id: uid,
      });
      throw err;
    }

    // Register in phone_numbers
    const { data: pn, error: pnErr } = await admin
      .from("phone_numbers")
      .insert({
        account_id: accountId,
        e164: bought.phoneNumber,
        friendly_name: bought.friendlyName,
        provider: "twilio",
        provider_config: {
          twilio_sid: bought.sid,
          capabilities: bought.capabilities,
          voice_url: voiceUrl,
          sms_url: smsUrl,
        },
        inbox_id: input.inbox_id ?? null,
        pinned_persona_id: input.pinned_persona_id ?? null,
        inbound_behavior: input.inbound_behavior ?? "ai_answer",
        outbound_enabled: true,
        enabled: true,
      })
      .select()
      .single();
    if (pnErr) {
      // Best-effort release to avoid paying for a number we can't track.
      try {
        await twilioNumbers.releaseNumber(creds, bought.sid);
      } catch (_) {
        /* ignore */
      }
      throw pnErr;
    }

    await admin.from("twilio_number_provisioning").insert({
      account_id: accountId,
      phone_number_id: pn.id,
      e164: bought.phoneNumber,
      action: "buy",
      request: input,
      response: bought.raw,
      http_status: 201,
      triggered_by_id: uid,
    });

    return j({ phone_number: pn, twilio: bought });
  } catch (err) {
    if (err instanceof TwilioConfigError) return j({ error: err.message }, err.status);
    console.error("[twilio-numbers-buy] failed", err);
    return j({ error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

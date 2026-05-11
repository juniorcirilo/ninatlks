// Search Twilio for available phone numbers to buy.
// Input: { country_code, type?: Local|TollFree|Mobile, area_code?, contains?, capabilities? }
// Returns a list of AvailableNumberRow.

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
    const countryCode = String(input.country_code ?? "BR").toUpperCase();
    const type = (input.type as "Local" | "TollFree" | "Mobile") ?? "Local";

    // Audit: any member can search, but log by account.
    const { data: memberships } = await admin
      .from("account_users")
      .select("account_id")
      .eq("user_id", uid);
    const accountId = input.account_id ?? memberships?.[0]?.account_id;
    if (!accountId) return j({ error: "no account context" }, 400);

    const creds = await loadAccountTwilioCreds(admin, accountId);
    const rows = await twilioNumbers.searchAvailableNumbers(creds, {
      countryCode,
      type,
      areaCode: input.area_code,
      contains: input.contains,
      smsEnabled: input.sms ?? true,
      voiceEnabled: input.voice ?? true,
      mmsEnabled: input.mms,
      limit: input.limit ?? 20,
    });

    await admin.from("twilio_number_provisioning").insert({
      account_id: accountId,
      e164: `search:${countryCode}/${type}`,
      action: "search",
      request: input,
      response: { count: rows.length, sample: rows.slice(0, 3) },
      http_status: 200,
      triggered_by_id: uid,
    });

    return j({ results: rows });
  } catch (err) {
    if (err instanceof TwilioConfigError) return j({ error: err.message }, err.status);
    console.error("[twilio-numbers-search] failed", err);
    return j({ error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

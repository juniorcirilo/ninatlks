// Import an EXISTING Twilio phone number into Nexus (vs twilio-numbers-buy
// which purchases a new one). Use case: trial accounts get a free number,
// legacy accounts have numbers already, and BYOC.
//
// Flow:
//   1. Verify number exists on the Twilio account via /IncomingPhoneNumbers
//   2. Update its voice_url / sms_url / statusCallback to our edge fns
//   3. Upsert phone_numbers row with twilio_sid + config
//
// Input: { account_id, phone_number (E.164), pinned_persona_id?,
//          inbox_id?, inbound_behavior? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import {
  loadAccountTwilioCreds,
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
    if (!accountId || !phoneNumber) {
      return j({ error: "account_id and phone_number required" }, 400);
    }

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
    const twauth = `Basic ${btoa(`${creds.apiKey ?? creds.accountSid}:${creds.apiSecret ?? creds.authToken}`)}`;

    // 1. Find the number on Twilio — it must already be in the account.
    const listRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phoneNumber)}`,
      { headers: { Authorization: twauth } },
    );
    if (!listRes.ok) {
      const t = await listRes.text().catch(() => "");
      return j({ error: `Twilio lookup failed: ${listRes.status} ${t.slice(0, 200)}` }, 502);
    }
    const list = (await listRes.json()) as any;
    const existing = list?.incoming_phone_numbers?.[0];
    if (!existing) {
      return j(
        {
          error: `Número ${phoneNumber} não encontrado na conta Twilio. Confere se comprou / tá ativo.`,
        },
        404,
      );
    }

    // 2. Update webhooks so inbound rings our edge fn.
    const updateBody = new URLSearchParams({
      VoiceUrl: voiceUrl,
      VoiceMethod: "POST",
      SmsUrl: smsUrl,
      SmsMethod: "POST",
      StatusCallback: statusCallback,
    });
    const updRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/IncomingPhoneNumbers/${existing.sid}.json`,
      {
        method: "POST",
        headers: {
          Authorization: twauth,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: updateBody,
      },
    );
    if (!updRes.ok) {
      const t = await updRes.text().catch(() => "");
      return j({ error: `Twilio update failed: ${updRes.status} ${t.slice(0, 200)}` }, 502);
    }
    const updated = (await updRes.json()) as any;

    // 3. Upsert phone_numbers. If the row already exists (e.g. re-import),
    //    keep its pin but refresh config.
    const { data: existingRow } = await admin
      .from("phone_numbers")
      .select("id")
      .eq("account_id", accountId)
      .eq("e164", phoneNumber)
      .maybeSingle();

    const baseRow = {
      account_id: accountId,
      e164: updated.phone_number,
      friendly_name: updated.friendly_name ?? `Nexus ${phoneNumber}`,
      provider: "twilio",
      provider_config: {
        twilio_sid: updated.sid,
        capabilities: updated.capabilities,
        voice_url: voiceUrl,
        sms_url: smsUrl,
      },
      inbox_id: input.inbox_id ?? null,
      pinned_persona_id: input.pinned_persona_id ?? null,
      inbound_behavior: input.inbound_behavior ?? "ai_answer",
      outbound_enabled: true,
      enabled: true,
    };

    let pn: any;
    if (existingRow) {
      const { data, error } = await admin
        .from("phone_numbers")
        .update(baseRow)
        .eq("id", existingRow.id)
        .select()
        .single();
      if (error) throw error;
      pn = data;
    } else {
      const { data, error } = await admin
        .from("phone_numbers")
        .insert(baseRow)
        .select()
        .single();
      if (error) throw error;
      pn = data;
    }

    await admin.from("twilio_number_provisioning").insert({
      account_id: accountId,
      phone_number_id: pn.id,
      e164: updated.phone_number,
      action: "import",
      request: input,
      response: updated,
      http_status: 200,
      triggered_by_id: uid,
    });

    return j({ phone_number: pn, twilio: updated });
  } catch (err) {
    if (err instanceof TwilioConfigError) return j({ error: err.message }, err.status);
    console.error("[twilio-numbers-import] failed", err);
    return j({ error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

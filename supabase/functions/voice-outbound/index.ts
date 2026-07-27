// Discador outbound — cria voice_calls row + chama Twilio /Calls.json.
// Centraliza guard (E.164/DNC/horário/rate-limit) em _shared/voice/guard.
// Suporta reuse via header X-Reuse-Voice-Call-Id (caminho de fallback EL→Twilio).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { guardCall, logAttempt } from "../_shared/voice/guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-reuse-voice-call-id",
};

interface Body {
  fromNumberId: string;
  toNumber: string;
  personaId?: string;
  timeoutSeconds?: number;
  contactId?: string;
  notes?: string;
  meetingId?: string;
  callPurpose?: "discovery" | "reminder" | "noshow_reschedule" | "followup";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return j({ error: "unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return j({ error: "unauthorized" }, 401);

    const body = (await req.json()) as Body;
    if (!body.fromNumberId || !body.toNumber) {
      return j({ error: "fromNumberId and toNumber required" }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const reuseCallId = req.headers.get("x-reuse-voice-call-id");

    // Auth check via user client (RLS)
    const { data: phoneNumber, error: phoneErr } = await userClient
      .from("phone_numbers")
      .select("id, account_id, e164, outbound_enabled, enabled")
      .eq("id", body.fromNumberId)
      .maybeSingle();

    if (phoneErr || !phoneNumber) {
      return j({ error: "phone number not found" }, 404);
    }
    if (!phoneNumber.enabled || !phoneNumber.outbound_enabled) {
      return j({ error: "outbound não habilitado para este número" }, 400);
    }

    // ── GUARD: E.164 + DNC + horário + rate-limit ───────────────
    const guard = await guardCall(supabase, {
      accountId: phoneNumber.account_id,
      toNumber: body.toNumber,
    });
    if (!guard.allowed) {
      await logAttempt(supabase, {
        accountId: phoneNumber.account_id,
        phoneNumber: body.toNumber,
        outcome: `blocked:${guard.reason}`,
      });
      // Bloqueios esperados de regra de discagem (ex: too_soon) não devem
      // sair como HTTP 4xx, porque o preview trata Edge 4xx como runtime error.
      return j({ ok: false, error: guard.message, reason: guard.reason, details: guard.details });
    }
    const toE164 = guard.e164;

    // ── Cria ou reusa voice_calls row ──────────────────────────
    let callId: string;
    if (reuseCallId) {
      // Caminho de fallback: a row já foi criada pela função chamadora (EL).
      // Validamos que pertence à mesma account antes de tocar.
      const { data: existing } = await supabase
        .from("voice_calls")
        .select("id, account_id")
        .eq("id", reuseCallId)
        .maybeSingle();
      if (!existing || existing.account_id !== phoneNumber.account_id) {
        return j({ error: "X-Reuse-Voice-Call-Id inválido" }, 403);
      }
      await supabase
        .from("voice_calls")
        .update({
          status: "queued",
          to_number: toE164,
          provider: "twilio",
        })
        .eq("id", reuseCallId);
      callId = reuseCallId;
    } else {
      const { data: call, error: callErr } = await supabase
        .from("voice_calls")
        .insert({
          account_id: phoneNumber.account_id,
          phone_number_id: phoneNumber.id,
          persona_id: body.personaId ?? null,
          direction: "outbound",
          status: "queued",
          provider: "twilio",
          from_number: phoneNumber.e164,
          to_number: toE164,
          started_at: new Date().toISOString(),
          metadata: {
            initiated_by: user.id,
            contact_id: body.contactId ?? null,
            notes: body.notes ?? null,
            meeting_id: body.meetingId ?? null,
            call_purpose: body.callPurpose ?? "discovery",
          },
        })
        .select("id")
        .single();
      if (callErr || !call) {
        return j({ error: "failed to create call row" }, 500);
      }
      callId = call.id;
    }

    if (!twilioSid || !twilioToken) {
      await supabase
        .from("voice_calls")
        .update({ status: "failed", metadata: { reason: "twilio_not_configured" } })
        .eq("id", callId);
      await logAttempt(supabase, {
        accountId: phoneNumber.account_id,
        phoneNumber: toE164,
        voiceCallId: callId,
        outcome: "failed:twilio_not_configured",
      });
      return j({
        callId,
        status: "failed",
        reason: "twilio_not_configured",
        message:
          "Configure TWILIO_ACCOUNT_SID e TWILIO_AUTH_TOKEN para ativar discagem.",
      });
    }

    // Twilio: webhook URL aponta para nossa edge function twilio-incoming
    const webhookUrl = `${supabaseUrl}/functions/v1/twilio-incoming`;
    const statusCallbackUrl = `${supabaseUrl}/functions/v1/twilio-status`;

    const auth = btoa(`${twilioSid}:${twilioToken}`);
    const form = new URLSearchParams({
      To: toE164,
      From: phoneNumber.e164,
      Url: webhookUrl,
      Timeout: String(body.timeoutSeconds ?? 30),
      StatusCallback: statusCallbackUrl,
      "StatusCallbackEvent": "initiated ringing answered completed",
    });

    const tw = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Calls.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form,
      },
    );
    const twData = await tw.json();

    if (!tw.ok) {
      await supabase
        .from("voice_calls")
        .update({ status: "failed", metadata: twData })
        .eq("id", callId);

      const twilioCode = typeof twData?.code === "number" ? twData.code : null;
      const userMessage = twilioCode === 21219
        ? "Número de destino não verificado. Contas Trial da Twilio só podem ligar pra números verificados."
        : (twData?.message ?? "Twilio recusou a ligação.");
      const reason = twilioCode === 21219
        ? "twilio_trial_unverified_number"
        : "twilio_call_failed";

      await logAttempt(supabase, {
        accountId: phoneNumber.account_id,
        phoneNumber: toE164,
        voiceCallId: callId,
        outcome: `failed:${reason}`,
      });

      return j({
        callId,
        status: "failed",
        reason,
        message: userMessage,
        error: twData,
      });
    }

    await supabase
      .from("voice_calls")
      .update({ provider_call_sid: twData.sid, status: "queued" })
      .eq("id", callId);

    await logAttempt(supabase, {
      accountId: phoneNumber.account_id,
      phoneNumber: toE164,
      voiceCallId: callId,
      outcome: "placed",
    });

    return j({ callId, callSid: twData.sid, status: "queued" });
  } catch (e) {
    console.error("[voice-outbound] error", e);
    return j({ error: String(e) }, 500);
  }
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

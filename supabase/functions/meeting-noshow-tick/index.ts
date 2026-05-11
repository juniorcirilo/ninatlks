// deno-lint-ignore-file no-explicit-any
//
// meeting-noshow-tick
// -------------------
// Cron */5 min: detecta reuniões que passaram do horário sem attended_at,
// marca detected_no_show_at, incrementa retry_count, e dispara uma chamada
// outbound de remarcação se ainda dentro do max_retries. Se já estourou,
// move o lead pro stage "Perdeu".
//
// Auth: service role only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { resolveCredentialsForAccount } from "../_shared/elevenlabs/client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const isService = (req.headers.get("Authorization") ?? "").includes(serviceKey);
  if (!isService) return j({ error: "service role required" }, 403);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  const { data: due, error: dueErr } = await admin.rpc("meeting_noshow_due", { p_limit: 25 });
  if (dueErr) {
    console.error("[meeting-noshow-tick] RPC failed", dueErr);
    return j({ error: dueErr.message }, 500);
  }
  const meetings = (due ?? []) as Array<{
    id: string;
    account_id: string;
    contact_id: string | null;
    starts_at: string;
    retry_count: number;
    max_retries: number;
    invitee_phone: string;
    invitee_name: string | null;
  }>;

  let dispatched = 0;
  let skipped = 0;
  const errors: { meeting_id: string; reason: string }[] = [];

  for (const m of meetings) {
    try {
      // 1. Marca como no-show detectado e incrementa retry_count
      await admin
        .from("scheduled_meetings")
        .update({
          detected_no_show_at: new Date().toISOString(),
          retry_count: m.retry_count + 1,
        })
        .eq("id", m.id);

      // 2. Dispara outbound de remarcação
      await dispatchReschedule(admin, m);
      dispatched++;
    } catch (e: any) {
      errors.push({ meeting_id: m.id, reason: String(e?.message ?? e) });
      skipped++;
    }
  }

  console.log(
    `[meeting-noshow-tick] checked=${meetings.length} dispatched=${dispatched} skipped=${skipped}`,
  );
  return j({ ok: true, checked: meetings.length, dispatched, skipped, errors });
});

async function dispatchReschedule(
  admin: any,
  meeting: {
    id: string;
    account_id: string;
    starts_at: string;
    invitee_phone: string;
    invitee_name: string | null;
  },
) {
  // 1. Phone outbound
  const { data: phone } = await admin
    .from("phone_numbers")
    .select("id, e164, elevenlabs_phone_number_id, pinned_persona_id")
    .eq("account_id", meeting.account_id)
    .eq("enabled", true)
    .eq("outbound_enabled", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!phone) throw new Error("no outbound phone configured for account");
  if (!phone.elevenlabs_phone_number_id) throw new Error("phone not registered in ElevenLabs");

  // 2. Persona
  let personaId: string | null = phone.pinned_persona_id ?? null;
  if (!personaId) {
    const { data: p } = await admin
      .from("agent_personas")
      .select("id")
      .eq("account_id", meeting.account_id)
      .eq("enabled", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    personaId = p?.id ?? null;
  }
  if (!personaId) throw new Error("no enabled persona on account");

  const { data: persona } = await admin
    .from("agent_personas")
    .select("elevenlabs_agent_id")
    .eq("id", personaId)
    .maybeSingle();
  if (!persona?.elevenlabs_agent_id) throw new Error("persona not synced with EL");

  const creds = await resolveCredentialsForAccount(admin, meeting.account_id);
  const elKey = creds.apiKey;

  // 3. Pre-create voice_calls row
  const { data: vc, error: vcErr } = await admin
    .from("voice_calls")
    .insert({
      account_id: meeting.account_id,
      phone_number_id: phone.id,
      persona_id: personaId,
      direction: "outbound",
      status: "queued",
      provider: "twilio",
      from_number: phone.e164,
      to_number: meeting.invitee_phone,
      started_at: new Date().toISOString(),
      metadata: {
        source: "meeting-noshow-tick",
        meeting_id: meeting.id,
        call_purpose: "noshow_reschedule",
      },
    })
    .select("id")
    .single();
  if (vcErr || !vc) throw new Error("failed to create voice_calls row");

  // 4. Dynamic vars
  const startsAt = new Date(meeting.starts_at);
  const startsHuman = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(startsAt);

  const leadName = (meeting.invitee_name ?? "").split(" ")[0] || "olá";

  const dynamicVariables: Record<string, string> = {
    call_purpose: "noshow_reschedule",
    meeting_id: meeting.id,
    meeting_starts_at_iso: meeting.starts_at,
    meeting_starts_at_human: startsHuman,
    lead_name: leadName,
    voice_call_id: vc.id,
  };

  const firstMessage = `Oi ${leadName}, é a Nina. Notei que você não conseguiu participar da nossa reunião ${startsHuman}. Tudo certo?`;

  // 5. Call EL outbound
  const elRes = await fetch("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", {
    method: "POST",
    headers: { "xi-api-key": elKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_id: persona.elevenlabs_agent_id,
      agent_phone_number_id: phone.elevenlabs_phone_number_id,
      to_number: meeting.invitee_phone,
      conversation_initiation_client_data: {
        conversation_config_override: {
          agent: { first_message: firstMessage },
        },
        dynamic_variables: dynamicVariables,
      },
    }),
  });
  const elData = await elRes.json().catch(() => ({}));
  if (!elRes.ok || elData?.success === false) {
    await admin
      .from("voice_calls")
      .update({ status: "failed", metadata: { error: `EL ${elRes.status}` } })
      .eq("id", vc.id);
    throw new Error(`EL outbound failed: ${elRes.status}`);
  }

  await admin
    .from("voice_calls")
    .update({
      provider_call_sid: elData.callSid,
      source_id: elData.conversation_id,
      status: "ringing",
    })
    .eq("id", vc.id);

  await admin
    .from("scheduled_meetings")
    .update({ reschedule_call_id: vc.id })
    .eq("id", meeting.id);

  console.log(
    `[meeting-noshow-tick] meeting=${meeting.id} call=${vc.id}`,
  );
}

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

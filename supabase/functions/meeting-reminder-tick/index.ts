// deno-lint-ignore-file no-explicit-any
//
// meeting-reminder-tick
// ---------------------
// Cron */1 min: encontra reuniões que começam em ~15 min e ainda não
// receberam o lembrete. Dispara uma chamada outbound da Nina via Twilio
// + ElevenLabs com call_purpose=reminder. O agente atende, lembra do
// horário e usa as tools confirmar_reuniao ou remarcar_reuniao.
//
// Auth: service role only.
//
// Idempotente: usa scheduled_meetings.reminder_sent_at pra evitar disparos
// duplicados se o cron rodar 2x dentro da janela.

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

  const { data: due, error: dueErr } = await admin.rpc("meeting_reminder_due", { p_limit: 25 });
  if (dueErr) {
    console.error("[meeting-reminder-tick] RPC failed", dueErr);
    return j({ error: dueErr.message }, 500);
  }
  const meetings = (due ?? []) as Array<{
    id: string;
    account_id: string;
    contact_id: string | null;
    starts_at: string;
    invitee_phone: string;
    invitee_name: string | null;
  }>;

  let dispatched = 0;
  let skipped = 0;
  const errors: { meeting_id: string; reason: string }[] = [];

  for (const m of meetings) {
    try {
      await dispatchReminder(admin, m);
      dispatched++;
    } catch (e: any) {
      errors.push({ meeting_id: m.id, reason: String(e?.message ?? e) });
      // Marca reminder_sent_at mesmo em erro pra não tentar para sempre.
      await admin
        .from("scheduled_meetings")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", m.id);
      skipped++;
    }
  }

  console.log(
    `[meeting-reminder-tick] checked=${meetings.length} dispatched=${dispatched} skipped=${skipped}`,
  );
  return j({ ok: true, checked: meetings.length, dispatched, skipped, errors });
});

async function dispatchReminder(
  admin: any,
  meeting: { id: string; account_id: string; starts_at: string; invitee_phone: string; invitee_name: string | null },
) {
  // 1. Pegar phone_number outbound da account
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
  if (!phone.elevenlabs_phone_number_id) {
    throw new Error("phone not registered in ElevenLabs (run sync)");
  }

  // 2. Pegar persona (pinned do número, ou default da account)
  let personaId: string | null = phone.pinned_persona_id ?? null;
  if (!personaId) {
    const { data: persona } = await admin
      .from("agent_personas")
      .select("id")
      .eq("account_id", meeting.account_id)
      .eq("enabled", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    personaId = persona?.id ?? null;
  }
  if (!personaId) throw new Error("no enabled persona on account");

  const { data: persona } = await admin
    .from("agent_personas")
    .select("elevenlabs_agent_id, first_message, name")
    .eq("id", personaId)
    .maybeSingle();
  if (!persona?.elevenlabs_agent_id) throw new Error("persona not synced with EL");

  // 3. Resolver EL key
  const creds = await resolveCredentialsForAccount(admin, meeting.account_id);
  const elKey = creds.apiKey;

  // 4. Pre-create voice_calls row
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
        source: "meeting-reminder-tick",
        meeting_id: meeting.id,
        call_purpose: "reminder",
      },
    })
    .select("id")
    .single();
  if (vcErr || !vc) throw new Error("failed to create voice_calls row");

  // 5. Build dynamic vars
  const startsAt = new Date(meeting.starts_at);
  const startsHuman = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(startsAt);

  const dynamicVariables: Record<string, string> = {
    call_purpose: "reminder",
    meeting_id: meeting.id,
    meeting_starts_at_iso: meeting.starts_at,
    meeting_starts_at_human: startsHuman,
    lead_name: (meeting.invitee_name ?? "").split(" ")[0] || "olá",
    voice_call_id: vc.id,
  };

  const firstMessage = `Oi ${dynamicVariables.lead_name}, é a Nina lembrando da nossa reunião ${startsHuman}. Tudo confirmado?`;

  // 6. Call EL outbound API
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
    // marca a row como failed
    await admin
      .from("voice_calls")
      .update({ status: "failed", metadata: { ...(elData ?? {}), error: `EL ${elRes.status}` } })
      .eq("id", vc.id);
    throw new Error(`EL outbound failed: ${elRes.status}`);
  }

  // 7. Update voice_calls + scheduled_meetings
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
    .update({
      reminder_call_id: vc.id,
      reminder_sent_at: new Date().toISOString(),
    })
    .eq("id", meeting.id);

  console.log(
    `[meeting-reminder-tick] meeting=${meeting.id} call=${vc.id} convo=${elData.conversation_id ?? "—"}`,
  );
}

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

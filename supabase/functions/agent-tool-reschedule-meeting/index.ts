// deno-lint-ignore-file no-explicit-any
//
// agent-tool-reschedule-meeting
// -----------------------------
// Tool chamada pelo agente quando o lead pede pra remarcar (em call de
// lembrete ou de no-show). Comportamento:
//   - action='reschedule': cria nova reunião (no novo horário) e marca a
//     antiga como 'rescheduled'. Reusa attendee da reunião original.
//   - action='cancel': marca a antiga como 'canceled' com motivo.
//
// Auth: header x-el-webhook-secret = ELEVENLABS_WEBHOOK_SECRET.
//
// Body (do agent):
// {
//   conversation_id: string,
//   meeting_id: string,                   // reunião original
//   action: "reschedule" | "cancel",
//   new_starts_at?: string,               // obrigatório se action=reschedule
//   duration_minutes?: number,            // default da original
//   reason?: string                       // motivo (cancel ou contexto)
// }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-el-webhook-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ ok: false, error: "method not allowed" }, 405);

  const expected = Deno.env.get("ELEVENLABS_WEBHOOK_SECRET") ?? "";
  const received = req.headers.get("x-el-webhook-secret") ?? "";
  if (!expected || expected !== received) return j({ ok: false, error: "unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); }
  catch { return j({ ok: false, error: "invalid json" }, 400); }

  const meetingId: string | undefined = body.meeting_id;
  const action: string | undefined = body.action;
  if (!meetingId || !action) {
    return j({ ok: false, error: "meeting_id and action required" }, 400);
  }
  if (action !== "reschedule" && action !== "cancel") {
    return j({ ok: false, error: "action must be 'reschedule' or 'cancel'" }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: original } = await admin
    .from("scheduled_meetings")
    .select("id, account_id, contact_id, attendee_user_id, doctor_id, modality, duration_minutes, briefing, sdr_call_id, invitee_name, invitee_email, invitee_phone, title")
    .eq("id", meetingId)
    .maybeSingle();
  if (!original) return j({ ok: false, error: "meeting not found" }, 404);

  if (action === "cancel") {
    await admin
      .from("scheduled_meetings")
      .update({
        status: "canceled",
        cancellation_reason: body.reason ?? "lead solicitou cancelamento",
        updated_at: new Date().toISOString(),
      })
      .eq("id", meetingId);
    console.log(`[agent-tool-reschedule-meeting] cancel meeting=${meetingId}`);
    return j({
      ok: true,
      action: "cancel",
      meeting_id: meetingId,
      confirmation_message: "Tudo bem, cancelei pra você. Se quiser remarcar depois, é só ligar de volta.",
    });
  }

  // action = reschedule
  const newStartsRaw: string | undefined = body.new_starts_at;
  if (!newStartsRaw) {
    return j({ ok: false, error: "new_starts_at required for reschedule" }, 400);
  }
  const newStarts = new Date(newStartsRaw);
  if (Number.isNaN(newStarts.getTime())) {
    return j({ ok: false, error: "invalid new_starts_at" }, 400);
  }
  if (newStarts.getTime() < Date.now() + 5 * 60_000) {
    return j({ ok: false, error: "new_starts_at must be at least 5 min in the future" }, 400);
  }

  const durationMin = clampInt(
    body.duration_minutes ?? (original as any).duration_minutes ?? 30,
    15,
    240,
  );
  const newEnds = new Date(newStarts.getTime() + durationMin * 60_000);

  // Verifica conflito (preferência: por doctor; fallback: por attendee)
  const conflictKey = (original as any).doctor_id ? "doctor_id" : "attendee_user_id";
  const conflictVal = (original as any).doctor_id ?? (original as any).attendee_user_id;
  if (conflictVal) {
    const { data: conflicts } = await admin
      .from("scheduled_meetings")
      .select("id")
      .eq("account_id", (original as any).account_id)
      .eq(conflictKey, conflictVal)
      .eq("status", "scheduled")
      .lt("starts_at", newEnds.toISOString())
      .gt("ends_at", newStarts.toISOString())
      .neq("id", meetingId);
    if (conflicts && conflicts.length > 0) {
      return j(
        { ok: false, error: "slot already booked", conflict_meeting_id: conflicts[0].id },
        409,
      );
    }
  }

  // Cria a nova reunião
  const { data: newMeeting, error: insErr } = await admin
    .from("scheduled_meetings")
    .insert({
      account_id: (original as any).account_id,
      contact_id: (original as any).contact_id,
      doctor_id: (original as any).doctor_id,
      modality: (original as any).modality,
      provider: "internal",
      provider_event_id: `nina-resched-${meetingId}-${Date.now()}`,
      title: (original as any).title,
      starts_at: newStarts.toISOString(),
      ends_at: newEnds.toISOString(),
      duration_minutes: durationMin,
      status: "scheduled",
      invitee_name: (original as any).invitee_name,
      invitee_email: (original as any).invitee_email,
      invitee_phone: (original as any).invitee_phone,
      attendee_user_id: (original as any).attendee_user_id,
      briefing: (original as any).briefing,
      sdr_call_id: (original as any).sdr_call_id,
      payload: {
        rescheduled_from: meetingId,
        reason: body.reason ?? null,
        scheduled_via: "agent_tool_reschedule",
      } as any,
    })
    .select("id, starts_at, ends_at")
    .single();
  if (insErr || !newMeeting) {
    console.error("[agent-tool-reschedule-meeting] insert failed", insErr);
    return j({ ok: false, error: "failed to create rescheduled meeting" }, 500);
  }

  // Marca a original como rescheduled
  await admin
    .from("scheduled_meetings")
    .update({
      status: "rescheduled",
      cancellation_reason: body.reason ?? "remarcada pelo lead",
      updated_at: new Date().toISOString(),
    })
    .eq("id", meetingId);

  // Move o contact pro stage "Reunião agendada" (mantém o score)
  if ((original as any).contact_id) {
    const { data: pipeline } = await admin
      .from("lead_pipelines")
      .select("id, lead_stages!inner(id, name)")
      .eq("account_id", (original as any).account_id)
      .eq("is_default", true)
      .eq("lead_stages.name", "Reunião agendada")
      .maybeSingle();
    const stages = (pipeline as any)?.lead_stages;
    const stageId = Array.isArray(stages) ? stages[0]?.id : stages?.id;
    if (stageId) {
      await admin
        .from("contacts")
        .update({ stage_id: stageId })
        .eq("id", (original as any).contact_id);
    }
  }

  console.log(
    `[agent-tool-reschedule-meeting] reschedule old=${meetingId} new=${newMeeting.id} starts=${newStarts.toISOString()}`,
  );

  return j({
    ok: true,
    action: "reschedule",
    old_meeting_id: meetingId,
    new_meeting_id: newMeeting.id,
    new_starts_at: newMeeting.starts_at,
    confirmation_message: `Remarcado. Vou anotar pra ${formatPtBr(newStarts)}.`,
  });
});

function clampInt(n: any, min: number, max: number): number {
  const v = parseInt(String(n), 10);
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function formatPtBr(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(d);
}

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

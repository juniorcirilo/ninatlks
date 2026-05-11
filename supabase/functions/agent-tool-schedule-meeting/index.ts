// deno-lint-ignore-file no-explicit-any
//
// agent-tool-schedule-meeting
// ---------------------------
// Marca uma consulta com um médico da clínica.
//
// Auth: header x-el-webhook-secret = ELEVENLABS_WEBHOOK_SECRET.
//
// Body:
// {
//   conversation_id: string,
//   doctor_id: string,                // obrigatório (vem do slot do get_availability)
//   starts_at: string,                // ISO8601
//   duration_minutes?: number,        // default = doctor.default_duration_minutes
//   modality?: "presencial" | "teleconsulta",
//   title?: string,
//   notes?: string                    // observações livres do agente
// }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-el-webhook-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ ok: false, error: "method not allowed" }, 405);

  const expected = Deno.env.get("ELEVENLABS_WEBHOOK_SECRET") ?? "";
  const received = req.headers.get("x-el-webhook-secret") ?? "";
  if (!expected || expected !== received) return j({ ok: false, error: "unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return j({ ok: false, error: "invalid json" }, 400); }

  const conversationId: string | undefined = body.conversation_id;
  const startsAtRaw: string | undefined = body.starts_at;
  const doctorId: string | undefined = body.doctor_id;
  if (!conversationId || !startsAtRaw || !doctorId) {
    return j({ ok: false, error: "conversation_id, doctor_id and starts_at are required" }, 400);
  }

  const startsAt = new Date(startsAtRaw);
  if (Number.isNaN(startsAt.getTime())) {
    return j({ ok: false, error: "invalid starts_at" }, 400);
  }
  if (startsAt.getTime() < Date.now() + 5 * 60_000) {
    return j({ ok: false, error: "starts_at must be at least 5 min in the future" }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 1. Resolve voice_call + account + contact
  const { data: call } = await admin
    .from("voice_calls")
    .select("id, account_id, conversation_id, from_number, classification")
    .eq("source_id", conversationId)
    .maybeSingle();
  if (!call) return j({ ok: false, error: "voice_call not found for conversation_id" }, 404);
  const accountId = (call as any).account_id;

  // 2. Resolve doctor (pertence ao account?)
  const { data: doctor } = await admin
    .from("doctors")
    .select("id, name, specialty, default_duration_minutes, modalities")
    .eq("id", doctorId)
    .eq("account_id", accountId)
    .eq("active", true)
    .maybeSingle();
  if (!doctor) return j({ ok: false, error: "doctor not found in this clinic" }, 404);

  const durationMin = clampInt(
    body.duration_minutes ?? (doctor as any).default_duration_minutes ?? 30,
    15,
    240,
  );
  const endsAt = new Date(startsAt.getTime() + durationMin * 60_000);

  const modality: string | null = (() => {
    const m = body.modality ? String(body.modality).toLowerCase() : null;
    if (!m) return null;
    if (m.includes("tele") || m.includes("online") || m.includes("video")) return "teleconsulta";
    return "presencial";
  })();

  // 3. Resolve contact
  let contactId: string | null = null;
  if ((call as any).conversation_id) {
    const { data: conv } = await admin
      .from("conversations")
      .select("contact_id")
      .eq("id", (call as any).conversation_id)
      .maybeSingle();
    contactId = (conv as any)?.contact_id ?? null;
  }
  if (!contactId && (call as any).from_number) {
    const { data: c } = await admin
      .from("contacts")
      .select("id")
      .eq("account_id", accountId)
      .eq("phone_number", (call as any).from_number)
      .maybeSingle();
    contactId = (c as any)?.id ?? null;
  }

  // 4. Conferir conflito por doctor
  const { data: conflicts } = await admin
    .from("scheduled_meetings")
    .select("id")
    .eq("account_id", accountId)
    .eq("doctor_id", doctorId)
    .eq("status", "scheduled")
    .lt("starts_at", endsAt.toISOString())
    .gt("ends_at", startsAt.toISOString());
  if (conflicts && conflicts.length > 0) {
    return j(
      { ok: false, error: "slot already booked for this doctor", conflict_meeting_id: conflicts[0].id },
      409,
    );
  }

  // 5. Briefing snapshot + invitee info
  const briefing = (call as any).classification?.briefing ?? null;
  const summary = (call as any).classification?.summary ?? null;
  const title = body.title ?? `Consulta com ${(doctor as any).name}`;

  let inviteeName: string | null = null;
  let inviteePhone: string | null = (call as any).from_number ?? null;
  let inviteeEmail: string | null = null;
  if (contactId) {
    const { data: c } = await admin
      .from("contacts")
      .select("name, email, phone_number")
      .eq("id", contactId)
      .maybeSingle();
    inviteeName = (c as any)?.name ?? null;
    inviteeEmail = (c as any)?.email ?? null;
    inviteePhone = (c as any)?.phone_number ?? inviteePhone;
  }

  // 6. Insert meeting
  const { data: meeting, error: insErr } = await admin
    .from("scheduled_meetings")
    .insert({
      account_id: accountId,
      contact_id: contactId,
      doctor_id: doctorId,
      provider: "internal",
      provider_event_id: `nina-${(call as any).id}-${Date.now()}`,
      title,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      duration_minutes: durationMin,
      status: "scheduled",
      modality,
      invitee_name: inviteeName,
      invitee_email: inviteeEmail,
      invitee_phone: inviteePhone,
      briefing,
      sdr_call_id: (call as any).id,
      payload: {
        scheduled_via: "agent_tool",
        agent_notes: body.notes ?? null,
        summary,
        doctor_name: (doctor as any).name,
        specialty: (doctor as any).specialty,
      } as any,
    })
    .select("id, starts_at, ends_at")
    .single();

  if (insErr || !meeting) {
    console.error("[agent-tool-schedule-meeting] insert failed", insErr);
    return j({ ok: false, error: "failed to create meeting" }, 500);
  }

  // 7. Move contact pro stage "Reunião agendada" (se pipeline tiver)
  if (contactId) {
    const { data: pipeline } = await admin
      .from("lead_pipelines")
      .select("id, lead_stages!inner(id, name)")
      .eq("account_id", accountId)
      .eq("is_default", true)
      .eq("lead_stages.name", "Reunião agendada")
      .maybeSingle();
    const stages = (pipeline as any)?.lead_stages;
    const stageId = Array.isArray(stages) ? stages[0]?.id : stages?.id;
    if (stageId) {
      await admin
        .from("contacts")
        .update({ stage_id: stageId, score: 95 })
        .eq("id", contactId);
    }
  }

  console.log(
    `[agent-tool-schedule-meeting] meeting=${(meeting as any).id} doctor=${doctorId} contact=${contactId} starts=${startsAt.toISOString()}`,
  );

  return j({
    ok: true,
    meeting_id: (meeting as any).id,
    starts_at: (meeting as any).starts_at,
    ends_at: (meeting as any).ends_at,
    doctor_name: (doctor as any).name,
    modality,
    confirmation_message: `Consulta agendada para ${formatPtBr(startsAt)} com ${(doctor as any).name}${modality ? ` (${modality})` : ""}.`,
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

// deno-lint-ignore-file no-explicit-any
//
// agent-tool-get-availability
// ---------------------------
// Tool webhook chamada pelo agente ElevenLabs durante a chamada para
// descobrir os próximos horários livres na agenda da CLÍNICA.
//
// Modelo: a agenda é por MÉDICO (não por usuário do Nexus). Cada médico
// tem janelas semanais (doctor_availability) e bloqueios pontuais
// (doctor_blocks). Conflitos são checados em scheduled_meetings.doctor_id.
//
// Auth: header x-el-webhook-secret = ELEVENLABS_WEBHOOK_SECRET.
//
// Body:
// {
//   conversation_id: string,
//   specialty?: string,            // filtra médicos por especialidade
//   doctor_id?: string,            // ou pega um médico específico
//   doctor_name?: string,          // match por nome (fuzzy contains)
//   duration_minutes?: number,     // default = doctor.default_duration_minutes
//   max_options?: number,          // default 4
//   days_ahead?: number            // default 14
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
  if (!expected || expected !== received) {
    return j({ ok: false, error: "unauthorized" }, 401);
  }

  let body: any;
  try { body = await req.json(); } catch { return j({ ok: false, error: "invalid json" }, 400); }

  const conversationId: string | undefined = body.conversation_id;
  if (!conversationId) return j({ ok: false, error: "conversation_id required" }, 400);

  const daysAhead = clampInt(body.days_ahead ?? 14, 1, 30);
  const maxOptions = clampInt(body.max_options ?? 4, 1, 10);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 1. Resolve account
  const { data: call } = await admin
    .from("voice_calls")
    .select("account_id")
    .eq("source_id", conversationId)
    .maybeSingle();
  if (!call) return j({ ok: false, error: "voice_call not found for conversation_id" }, 404);
  const accountId = (call as any).account_id;

  // 2. Filtra médicos
  let doctorsQ = admin
    .from("doctors")
    .select("id, name, specialty, modalities, default_duration_minutes")
    .eq("account_id", accountId)
    .eq("active", true);

  if (body.doctor_id) {
    doctorsQ = doctorsQ.eq("id", body.doctor_id);
  } else if (body.specialty) {
    doctorsQ = doctorsQ.ilike("specialty", `%${body.specialty}%`);
  } else if (body.doctor_name) {
    doctorsQ = doctorsQ.ilike("name", `%${body.doctor_name}%`);
  }

  const { data: doctors } = await doctorsQ;
  if (!doctors || doctors.length === 0) {
    const filterDesc = body.specialty
      ? `pra especialidade "${body.specialty}"`
      : body.doctor_name
        ? `pra ${body.doctor_name}`
        : "cadastrado";
    return j({
      ok: true,
      slots: [],
      friendly_message:
        `Não encontrei nenhum médico ${filterDesc} aqui na agenda. Posso te transferir pra recepção pra ela te ajudar?`,
    });
  }

  // 3. Janelas + bloqueios + reuniões já marcadas (uma única query global por account)
  const doctorIds = doctors.map((d: any) => d.id);
  const horizon = new Date(Date.now() + daysAhead * 86400_000);

  const [{ data: avail }, { data: blocks }, { data: meetings }] = await Promise.all([
    admin.from("doctor_availability")
      .select("doctor_id, weekday, start_time, end_time")
      .in("doctor_id", doctorIds),
    admin.from("doctor_blocks")
      .select("doctor_id, starts_at, ends_at")
      .in("doctor_id", doctorIds)
      .gte("ends_at", new Date().toISOString())
      .lt("starts_at", horizon.toISOString()),
    admin.from("scheduled_meetings")
      .select("doctor_id, starts_at, ends_at, status")
      .eq("account_id", accountId)
      .in("doctor_id", doctorIds)
      .eq("status", "scheduled")
      .gte("starts_at", new Date().toISOString())
      .lt("starts_at", horizon.toISOString()),
  ]);

  if (!avail || avail.length === 0) {
    return j({
      ok: true,
      slots: [],
      friendly_message:
        "A agenda do médico ainda não foi configurada aqui no sistema. Posso te transferir pra recepção?",
    });
  }

  const durationDefault = clampInt(body.duration_minutes ?? 30, 15, 240);

  // 4. Gera slots por médico, distribuindo nas próximas datas
  const slots = generateSlotsForDoctors({
    doctors: doctors as any[],
    availability: avail as any[],
    blocks: (blocks ?? []) as any[],
    meetings: (meetings ?? []) as any[],
    daysAhead,
    durationDefault,
  });

  if (slots.length === 0) {
    return j({
      ok: true,
      slots: [],
      friendly_message:
        "Não tenho horários livres nas próximas semanas pra esse médico. Posso te ligar de volta quando abrir vaga, ou te passar pra recepção?",
    });
  }

  // 5. Espalha as opções (1ª de cada dia, intercalando médicos quando há mais de 1)
  const seenDays = new Set<string>();
  const picked: any[] = [];
  for (const s of slots) {
    const dayKey = s.starts_at.slice(0, 10) + ":" + s.doctor_id;
    if (seenDays.has(dayKey)) continue;
    seenDays.add(dayKey);
    picked.push(s);
    if (picked.length >= maxOptions) break;
  }

  const friendly = "Tenho estes horários: " +
    picked.map((p, i) => `(${i + 1}) ${p.label}`).join("; ") +
    ". Qual encaixa melhor pra você?";

  return j({ ok: true, slots: picked, friendly_message: friendly });
});

function generateSlotsForDoctors(args: {
  doctors: any[];
  availability: any[];
  blocks: any[];
  meetings: any[];
  daysAhead: number;
  durationDefault: number;
}) {
  const { doctors, availability, blocks, meetings, daysAhead, durationDefault } = args;
  const now = new Date();
  const out: any[] = [];

  const availByDoctor = new Map<string, any[]>();
  for (const a of availability) {
    const arr = availByDoctor.get(a.doctor_id) ?? [];
    arr.push(a);
    availByDoctor.set(a.doctor_id, arr);
  }

  for (const doc of doctors) {
    const docAvail = availByDoctor.get(doc.id) ?? [];
    if (docAvail.length === 0) continue;
    const duration = doc.default_duration_minutes ?? durationDefault;

    for (let dayOffset = 0; dayOffset <= daysAhead; dayOffset++) {
      const d = new Date(now);
      d.setDate(d.getDate() + dayOffset);
      const weekday = d.getDay();
      const dayKey = d.toISOString().slice(0, 10);

      for (const a of docAvail) {
        if (a.weekday !== weekday) continue;
        const [sh, sm] = String(a.start_time).split(":").map(Number);
        const [eh, em] = String(a.end_time).split(":").map(Number);
        const slotStart = new Date(`${dayKey}T${pad(sh)}:${pad(sm)}:00`);
        const slotEnd = new Date(`${dayKey}T${pad(eh)}:${pad(em)}:00`);
        let cursor = new Date(slotStart);

        while (cursor.getTime() + duration * 60_000 <= slotEnd.getTime()) {
          const slotEndsAt = new Date(cursor.getTime() + duration * 60_000);
          // Pular se for muito próximo do agora
          if (cursor.getTime() <= now.getTime() + 30 * 60_000) {
            cursor = new Date(cursor.getTime() + duration * 60_000);
            continue;
          }
          const conflictMeeting = meetings.some((m) =>
            m.doctor_id === doc.id &&
            new Date(m.starts_at).getTime() < slotEndsAt.getTime() &&
            (m.ends_at ? new Date(m.ends_at).getTime() : new Date(m.starts_at).getTime() + duration * 60_000) > cursor.getTime()
          );
          const conflictBlock = blocks.some((b) =>
            b.doctor_id === doc.id &&
            new Date(b.starts_at).getTime() < slotEndsAt.getTime() &&
            new Date(b.ends_at).getTime() > cursor.getTime()
          );
          if (!conflictMeeting && !conflictBlock) {
            out.push({
              doctor_id: doc.id,
              doctor_name: doc.name,
              specialty: doc.specialty,
              modalities: doc.modalities,
              starts_at: cursor.toISOString(),
              ends_at: slotEndsAt.toISOString(),
              duration_min: duration,
              label: `${formatSlotPtBr(cursor)} com ${doc.name}${doc.specialty ? ` (${doc.specialty})` : ""}`,
            });
          }
          cursor = new Date(cursor.getTime() + duration * 60_000);
        }
      }
    }
  }

  out.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return out;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatSlotPtBr(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(d);
}

function clampInt(n: any, min: number, max: number): number {
  const v = parseInt(String(n), 10);
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

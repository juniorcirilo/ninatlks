import { supabase } from "@/integrations/supabase/client";

export type MeetingStatus =
  | "scheduled"
  | "attended"
  | "no_show"
  | "rescheduled"
  | "canceled";

export type Meeting = {
  id: string;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  duration_minutes: number | null;
  status: MeetingStatus;
  invitee_name: string | null;
  invitee_email: string | null;
  invitee_phone: string | null;
  meeting_url: string | null;
  attendee_user_id: string | null;
  attendee_name: string | null;
  briefing: {
    dor?: string | null;
    fit?: string | null;
    objections?: string[];
    next_action?: string | null;
  } | null;
  notes: string | null;
  sdr_call_id: string | null;
  contact_id: string | null;
  attended_at: string | null;
  detected_no_show_at: string | null;
  cancellation_reason: string | null;
};

export type AvailabilitySlot = {
  id: string;
  user_id: string;
  user_name: string | null;
  weekday: number;       // 0..6 (0=domingo)
  start_time: string;    // "HH:MM:SS"
  end_time: string;
};

export const MEETING_STATUS_LABEL: Record<MeetingStatus, { label: string; cls: string }> = {
  scheduled:   { label: "Agendada",  cls: "bg-amber-50 text-amber-700 ring-amber-200" },
  attended:    { label: "Realizada", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  no_show:     { label: "No-show",   cls: "bg-rose-50 text-rose-700 ring-rose-200" },
  rescheduled: { label: "Remarcada", cls: "bg-violet-50 text-violet-700 ring-violet-200" },
  canceled:    { label: "Cancelada", cls: "bg-slate-100 text-slate-600 ring-slate-200" },
};

// ============================================================
// Médicos (entidades configuráveis pelo admin, não usuários)
// ============================================================

export type DoctorWeeklySlot = {
  weekday: number;       // 0..6
  start_time: string;    // "HH:MM:SS"
  end_time: string;
};

export type Doctor = {
  id: string;
  name: string;
  specialty: string | null;
  modalities: string[];
  default_duration_minutes: number;
  notes: string | null;
  active: boolean;
  weekly_slots: DoctorWeeklySlot[];
};

export async function fetchDoctors(accountId: string): Promise<Doctor[]> {
  const { data, error } = await (supabase as any).rpc("doctors_list", {
    p_account_id: accountId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as Doctor[];
}

export async function upsertDoctor(input: {
  id?: string;
  account_id: string;
  name: string;
  specialty?: string | null;
  modalities: string[];
  default_duration_minutes: number;
  notes?: string | null;
  active?: boolean;
}): Promise<string> {
  if (input.id) {
    const { error } = await supabase
      .from("doctors")
      .update({
        name: input.name,
        specialty: input.specialty ?? null,
        modalities: input.modalities,
        default_duration_minutes: input.default_duration_minutes,
        notes: input.notes ?? null,
        active: input.active ?? true,
      })
      .eq("id", input.id);
    if (error) throw new Error(error.message);
    return input.id;
  }
  const { data, error } = await supabase
    .from("doctors")
    .insert({
      account_id: input.account_id,
      name: input.name,
      specialty: input.specialty ?? null,
      modalities: input.modalities,
      default_duration_minutes: input.default_duration_minutes,
      notes: input.notes ?? null,
      active: input.active ?? true,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "falha ao criar médico");
  return (data as any).id;
}

export async function deleteDoctor(doctorId: string): Promise<void> {
  const { error } = await supabase.from("doctors").delete().eq("id", doctorId);
  if (error) throw new Error(error.message);
}

export async function setDoctorAvailability(
  accountId: string,
  doctorId: string,
  slots: DoctorWeeklySlot[],
): Promise<void> {
  const { error } = await (supabase as any).rpc("doctor_set_availability", {
    p_account_id: accountId,
    p_doctor_id: doctorId,
    p_slots: slots,
  });
  if (error) throw new Error(error.message);
}

export const WEEKDAY_LABEL = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export async function fetchMeetings(
  accountId: string,
  start: Date,
  end: Date,
): Promise<Meeting[]> {
  const { data, error } = await (supabase as any).rpc("meetings_list", {
    p_account_id: accountId,
    p_start: start.toISOString(),
    p_end: end.toISOString(),
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as Meeting[];
}

export async function setMeetingOutcome(
  meetingId: string,
  status: MeetingStatus,
  opts: { notes?: string; cancellationReason?: string } = {},
): Promise<void> {
  const { error } = await (supabase as any).rpc("meetings_set_outcome", {
    p_meeting_id: meetingId,
    p_status: status,
    p_notes: opts.notes ?? null,
    p_cancellation_reason: opts.cancellationReason ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function fetchWeeklyAvailability(accountId: string): Promise<AvailabilitySlot[]> {
  const { data, error } = await (supabase as any).rpc("availability_get_weekly", {
    p_account_id: accountId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as AvailabilitySlot[];
}

export async function setWeeklyAvailability(
  accountId: string,
  userId: string,
  slots: { weekday: number; start_time: string; end_time: string }[],
): Promise<void> {
  const { error } = await (supabase as any).rpc("availability_set_weekly", {
    p_account_id: accountId,
    p_user_id: userId,
    p_slots: slots,
  });
  if (error) throw new Error(error.message);
}

export function formatMeetingTime(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function startOfWeek(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  out.setDate(out.getDate() - out.getDay()); // domingo = 0
  return out;
}

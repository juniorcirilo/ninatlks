import { apiClient } from "@/lib/api-client";

export type MeetingStatus = "scheduled" | "attended" | "no_show" | "rescheduled" | "canceled";

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
  weekday: number; // 0..6 (0=domingo)
  start_time: string; // "HH:MM:SS"
  end_time: string;
};

export const MEETING_STATUS_LABEL: Record<MeetingStatus, { label: string; cls: string }> = {
  scheduled: { label: "Agendada", cls: "bg-amber-500/15 text-amber-400 ring-amber-500/30" },
  attended: { label: "Realizada", cls: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30" },
  no_show: { label: "No-show", cls: "bg-rose-500/15 text-rose-400 ring-rose-500/30" },
  rescheduled: { label: "Remarcada", cls: "bg-violet-500/15 text-violet-400 ring-violet-500/30" },
  canceled: { label: "Cancelada", cls: "bg-slate-500/15 text-slate-400 ring-slate-500/30" },
};

// ============================================================
// Médicos (entidades configuráveis pelo admin, não usuários)
// ============================================================

export type DoctorWeeklySlot = {
  weekday: number; // 0..6
  start_time: string; // "HH:MM:SS"
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
  return apiClient.get<Doctor[]>(`/accounts/${accountId}/doctors`);
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
  const payload = {
    name: input.name,
    specialty: input.specialty ?? undefined,
    modalities: input.modalities,
    defaultDurationMinutes: input.default_duration_minutes,
    notes: input.notes ?? undefined,
    active: input.active ?? true,
  };
  if (input.id) {
    await apiClient.patch(`/accounts/${input.account_id}/doctors/${input.id}`, payload);
    return input.id;
  }
  const { id } = await apiClient.post<{ id: string }>(
    `/accounts/${input.account_id}/doctors`,
    payload,
  );
  return id;
}

export async function deleteDoctor(accountId: string, doctorId: string): Promise<void> {
  await apiClient.delete(`/accounts/${accountId}/doctors/${doctorId}`);
}

export async function setDoctorAvailability(
  accountId: string,
  doctorId: string,
  slots: DoctorWeeklySlot[],
): Promise<void> {
  await apiClient.put(`/accounts/${accountId}/doctors/${doctorId}/availability`, { slots });
}

export const WEEKDAY_LABEL = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export async function fetchMeetings(accountId: string, start: Date, end: Date): Promise<Meeting[]> {
  const params = new URLSearchParams({
    start: start.toISOString(),
    end: end.toISOString(),
  });
  return apiClient.get<Meeting[]>(`/accounts/${accountId}/meetings?${params.toString()}`);
}

export type CreateMeetingInput = {
  title?: string;
  startsAt: string; // ISO
  durationMinutes: number;
  hostUserId: string;
  inviteeName?: string;
  inviteeEmail?: string;
  inviteePhone?: string;
  contactId?: string;
  doctorId?: string;
  modality?: string;
  notes?: string;
  useGoogleMeet?: boolean;
};

export async function createMeeting(
  accountId: string,
  input: CreateMeetingInput,
): Promise<{ id: string }> {
  return apiClient.post<{ id: string }>(`/accounts/${accountId}/meetings`, input);
}

export async function updateMeeting(
  accountId: string,
  meetingId: string,
  patch: { title?: string; startsAt?: string; durationMinutes?: number },
): Promise<void> {
  await apiClient.patch(`/accounts/${accountId}/meetings/${meetingId}`, patch);
}

export async function cancelMeeting(accountId: string, meetingId: string): Promise<void> {
  await apiClient.delete(`/accounts/${accountId}/meetings/${meetingId}`);
}

export async function setMeetingOutcome(
  accountId: string,
  meetingId: string,
  status: MeetingStatus,
  opts: { notes?: string; cancellationReason?: string } = {},
): Promise<void> {
  await apiClient.patch(`/accounts/${accountId}/meetings/${meetingId}/outcome`, {
    status,
    notes: opts.notes,
    cancellationReason: opts.cancellationReason,
  });
}

export async function fetchWeeklyAvailability(accountId: string): Promise<AvailabilitySlot[]> {
  return apiClient.get<AvailabilitySlot[]>(`/accounts/${accountId}/availability`);
}

export async function setWeeklyAvailability(
  accountId: string,
  userId: string,
  slots: { weekday: number; start_time: string; end_time: string }[],
): Promise<void> {
  await apiClient.put(`/accounts/${accountId}/availability`, { userId, slots });
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

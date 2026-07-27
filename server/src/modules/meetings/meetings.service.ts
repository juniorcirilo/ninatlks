import { Injectable, Scope } from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';

export interface Meeting {
  id: string;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  duration_minutes: number | null;
  status: string;
  invitee_name: string | null;
  invitee_email: string | null;
  invitee_phone: string | null;
  meeting_url: string | null;
  attendee_user_id: string | null;
  attendee_name: string | null;
  briefing: Record<string, unknown> | null;
  notes: string | null;
  sdr_call_id: string | null;
  contact_id: string | null;
  attended_at: string | null;
  detected_no_show_at: string | null;
  cancellation_reason: string | null;
}

export interface AvailabilitySlot {
  id: string;
  user_id: string;
  user_name: string | null;
  weekday: number;
  start_time: string;
  end_time: string;
}

export interface Doctor {
  id: string;
  name: string;
  specialty: string | null;
  modalities: string[];
  default_duration_minutes: number;
  notes: string | null;
  active: boolean;
  weekly_slots: { weekday: number; start_time: string; end_time: string }[];
}

/**
 * meetings_list/meetings_set_outcome/availability_get_weekly/
 * availability_set_weekly/doctors_list/doctor_set_availability are all
 * SECURITY DEFINER SQL functions that already do their own authorization
 * via auth.uid() internally — this service doesn't duplicate that in
 * TypeScript. Only the plain doctors CRUD (no RPC wrapper exists for it in
 * the original schema) relies on AccountMemberGuard/RolesGuard + RLS
 * instead, same as ContactsService.
 */
@Injectable({ scope: Scope.REQUEST })
export class MeetingsService {
  constructor(private readonly tx: TenantTxHost) {}

  async listMeetings(
    accountId: string,
    start: string,
    end: string,
  ): Promise<Meeting[]> {
    const rows = await this.tx.manager.query<{ meetings_list: Meeting[] }[]>(
      `SELECT public.meetings_list($1, $2, $3) AS meetings_list`,
      [accountId, start, end],
    );
    return rows[0].meetings_list;
  }

  async setOutcome(
    meetingId: string,
    status: string,
    notes?: string,
    cancellationReason?: string,
  ): Promise<void> {
    await this.tx.manager.query(
      `SELECT public.meetings_set_outcome($1, $2, $3, $4)`,
      [meetingId, status, notes ?? null, cancellationReason ?? null],
    );
  }

  async getWeeklyAvailability(accountId: string): Promise<AvailabilitySlot[]> {
    const rows = await this.tx.manager.query<
      { availability_get_weekly: AvailabilitySlot[] }[]
    >(`SELECT public.availability_get_weekly($1) AS availability_get_weekly`, [
      accountId,
    ]);
    return rows[0].availability_get_weekly;
  }

  async setWeeklyAvailability(
    accountId: string,
    userId: string,
    slots: { weekday: number; start_time: string; end_time: string }[],
  ): Promise<void> {
    await this.tx.manager.query(
      `SELECT public.availability_set_weekly($1, $2, $3::jsonb)`,
      [accountId, userId, JSON.stringify(slots)],
    );
  }

  async listDoctors(accountId: string): Promise<Doctor[]> {
    return this.tx.manager.query<Doctor[]>(
      `SELECT * FROM public.doctors_list($1)`,
      [accountId],
    );
  }

  async setDoctorAvailability(
    accountId: string,
    doctorId: string,
    slots: { weekday: number; start_time: string; end_time: string }[],
  ): Promise<void> {
    await this.tx.manager.query(
      `SELECT public.doctor_set_availability($1, $2, $3::jsonb)`,
      [accountId, doctorId, JSON.stringify(slots)],
    );
  }

  async createDoctor(
    accountId: string,
    input: {
      name: string;
      specialty?: string | null;
      modalities: string[];
      defaultDurationMinutes: number;
      notes?: string | null;
      active?: boolean;
    },
  ): Promise<{ id: string }> {
    const rows = await this.tx.manager.query<{ id: string }[]>(
      `INSERT INTO public.doctors
         (account_id, name, specialty, modalities, default_duration_minutes, notes, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        accountId,
        input.name,
        input.specialty ?? null,
        input.modalities,
        input.defaultDurationMinutes,
        input.notes ?? null,
        input.active ?? true,
      ],
    );
    return rows[0];
  }

  async updateDoctor(
    accountId: string,
    id: string,
    input: {
      name: string;
      specialty?: string | null;
      modalities: string[];
      defaultDurationMinutes: number;
      notes?: string | null;
      active?: boolean;
    },
  ): Promise<void> {
    await this.tx.manager.query(
      `UPDATE public.doctors
       SET name = $3, specialty = $4, modalities = $5, default_duration_minutes = $6,
           notes = $7, active = $8
       WHERE id = $1 AND account_id = $2`,
      [
        id,
        accountId,
        input.name,
        input.specialty ?? null,
        input.modalities,
        input.defaultDurationMinutes,
        input.notes ?? null,
        input.active ?? true,
      ],
    );
  }

  async deleteDoctor(accountId: string, id: string): Promise<void> {
    await this.tx.manager.query(
      `DELETE FROM public.doctors WHERE id = $1 AND account_id = $2`,
      [id, accountId],
    );
  }
}

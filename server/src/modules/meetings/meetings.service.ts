import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Scope,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TenantTxHost } from '../../common/tenant-tx.host';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { MeetingNotificationsService } from '../meeting-notifications/meeting-notifications.service';

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
  private readonly logger = new Logger(MeetingsService.name);

  constructor(
    private readonly tx: TenantTxHost,
    private readonly googleCalendar: GoogleCalendarService,
    private readonly meetingNotifications: MeetingNotificationsService,
  ) {}

  async createMeeting(
    accountId: string,
    dto: {
      title?: string;
      startsAt: string;
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
    },
  ): Promise<{ id: string }> {
    const host = await this.tx.manager.query<{ user_id: string }[]>(
      `SELECT user_id FROM public.account_users WHERE account_id = $1 AND user_id = $2`,
      [accountId, dto.hostUserId],
    );
    if (!host.length) {
      throw new BadRequestException('Host não pertence a esta conta.');
    }

    const startsAt = new Date(dto.startsAt);
    if (Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException('startsAt inválido.');
    }
    const endsAt = new Date(startsAt.getTime() + dto.durationMinutes * 60_000);
    const title = dto.title?.trim() || `Reunião com ${dto.inviteeName ?? 'lead'}`;

    let provider = 'internal';
    let providerEventId = `manual-${randomUUID()}`;
    let meetingUrl: string | null = null;

    if (dto.useGoogleMeet !== false) {
      const status = await this.googleCalendar.getStatus(accountId);
      if (status.connected) {
        const event = await this.googleCalendar.createMeetEvent(accountId, {
          title,
          description: dto.notes ?? null,
          startsAt,
          endsAt,
          attendeeEmails: dto.inviteeEmail ? [dto.inviteeEmail] : [],
        });
        provider = 'google_calendar';
        providerEventId = event.providerEventId;
        meetingUrl = event.meetingUrl;
      }
    }

    const rows = await this.tx.manager.query<{ id: string }[]>(
      `INSERT INTO public.scheduled_meetings
         (account_id, contact_id, doctor_id, provider, provider_event_id, title, starts_at, ends_at,
          duration_minutes, status, modality, invitee_name, invitee_email, invitee_phone, notes,
          attendee_user_id, meeting_url, payload, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'scheduled',$10,$11,$12,$13,$14,$15,$16,$17::jsonb, now(), now())
       RETURNING id`,
      [
        accountId,
        dto.contactId ?? null,
        dto.doctorId ?? null,
        provider,
        providerEventId,
        title,
        startsAt,
        endsAt,
        dto.durationMinutes,
        dto.modality ?? null,
        dto.inviteeName ?? null,
        dto.inviteeEmail ?? null,
        dto.inviteePhone ?? null,
        dto.notes ?? null,
        dto.hostUserId,
        meetingUrl,
        JSON.stringify({ scheduled_via: 'manual' }),
      ],
    );
    const meetingId = rows[0].id;

    await this.meetingNotifications
      .notifyMeetingScheduled({
        id: meetingId,
        accountId,
        title,
        startsAt,
        endsAt,
        durationMinutes: dto.durationMinutes,
        meetingUrl,
        status: 'scheduled',
        hostUserId: dto.hostUserId,
        inviteeName: dto.inviteeName ?? null,
        inviteeEmail: dto.inviteeEmail ?? null,
        inviteePhone: dto.inviteePhone ?? null,
        scheduledVia: 'manual',
      })
      .catch((err) =>
        this.logger.error(`notify falhou meeting=${meetingId}: ${(err as Error).message}`),
      );

    return { id: meetingId };
  }

  async updateMeeting(
    accountId: string,
    id: string,
    patch: { title?: string; startsAt?: string; durationMinutes?: number },
  ): Promise<void> {
    const rows = await this.tx.manager.query<
      {
        provider: string;
        provider_event_id: string;
        starts_at: string;
        duration_minutes: number | null;
      }[]
    >(
      `SELECT provider, provider_event_id, starts_at, duration_minutes
         FROM public.scheduled_meetings WHERE id = $1 AND account_id = $2`,
      [id, accountId],
    );
    const existing = rows[0];
    if (!existing) throw new NotFoundException('Reunião não encontrada.');

    const newStartsAt = patch.startsAt ? new Date(patch.startsAt) : new Date(existing.starts_at);
    const newDuration = patch.durationMinutes ?? existing.duration_minutes ?? 30;
    const newEndsAt = new Date(newStartsAt.getTime() + newDuration * 60_000);

    await this.tx.manager.query(
      `UPDATE public.scheduled_meetings
          SET title = COALESCE($3, title), starts_at = $4, ends_at = $5, duration_minutes = $6, updated_at = now()
        WHERE id = $1 AND account_id = $2`,
      [id, accountId, patch.title ?? null, newStartsAt, newEndsAt, newDuration],
    );

    if (existing.provider === 'google_calendar') {
      await this.googleCalendar.updateMeetEvent(accountId, existing.provider_event_id, {
        startsAt: newStartsAt,
        endsAt: newEndsAt,
        title: patch.title,
      });
    }
  }

  async rescheduleMeeting(
    accountId: string,
    id: string,
    patch: { startsAt: string; durationMinutes?: number; notes?: string },
  ): Promise<void> {
    const rows = await this.tx.manager.query<
      {
        provider: string;
        provider_event_id: string;
        duration_minutes: number | null;
        title: string | null;
        meeting_url: string | null;
        invitee_name: string | null;
        invitee_email: string | null;
        invitee_phone: string | null;
        attendee_user_id: string | null;
      }[]
    >(
      `SELECT provider, provider_event_id, duration_minutes, title, meeting_url,
              invitee_name, invitee_email, invitee_phone, attendee_user_id
         FROM public.scheduled_meetings WHERE id = $1 AND account_id = $2`,
      [id, accountId],
    );
    const existing = rows[0];
    if (!existing) throw new NotFoundException('Reunião não encontrada.');

    const startsAt = new Date(patch.startsAt);
    if (Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException('startsAt inválido.');
    }
    const durationMinutes = patch.durationMinutes ?? existing.duration_minutes ?? 30;
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);

    await this.tx.manager.query(
      `UPDATE public.scheduled_meetings
          SET starts_at = $3, ends_at = $4, duration_minutes = $5, status = 'rescheduled',
              notes = COALESCE($6, notes), updated_at = now()
        WHERE id = $1 AND account_id = $2`,
      [id, accountId, startsAt, endsAt, durationMinutes, patch.notes ?? null],
    );

    if (existing.provider === 'google_calendar') {
      await this.googleCalendar
        .updateMeetEvent(accountId, existing.provider_event_id, { startsAt, endsAt })
        .catch((err) =>
          this.logger.error(
            `atualizar evento no Google falhou meeting=${id}: ${(err as Error).message}`,
          ),
        );
    }

    await this.meetingNotifications
      .notifyMeetingRescheduled({
        id,
        accountId,
        title: existing.title,
        startsAt,
        endsAt,
        durationMinutes,
        meetingUrl: existing.meeting_url,
        status: 'rescheduled',
        hostUserId: existing.attendee_user_id,
        inviteeName: existing.invitee_name,
        inviteeEmail: existing.invitee_email,
        inviteePhone: existing.invitee_phone,
        scheduledVia: 'manual',
      })
      .catch((err) =>
        this.logger.error(`notify reschedule falhou meeting=${id}: ${(err as Error).message}`),
      );
  }

  async cancelMeeting(accountId: string, id: string, reason?: string): Promise<void> {
    const rows = await this.tx.manager.query<
      { provider: string; provider_event_id: string }[]
    >(
      `SELECT provider, provider_event_id FROM public.scheduled_meetings WHERE id = $1 AND account_id = $2`,
      [id, accountId],
    );
    const existing = rows[0];
    if (!existing) throw new NotFoundException('Reunião não encontrada.');

    await this.setOutcome(id, 'canceled', undefined, reason ?? 'manual');

    if (existing.provider === 'google_calendar') {
      await this.googleCalendar
        .cancelMeetEvent(accountId, existing.provider_event_id)
        .catch((err) =>
          this.logger.error(`cancelar evento no Google falhou meeting=${id}: ${(err as Error).message}`),
        );
    }
  }

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

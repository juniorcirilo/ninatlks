import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EmailService } from '../email/email.service';
import { WebhookDispatchService } from '../webhook-endpoints/webhook-dispatch.service';

export interface MeetingScheduledNotification {
  id: string;
  accountId: string;
  title: string | null;
  startsAt: Date;
  endsAt: Date | null;
  durationMinutes: number | null;
  meetingUrl: string | null;
  status: string;
  hostUserId: string | null;
  inviteeName: string | null;
  inviteeEmail: string | null;
  inviteePhone: string | null;
  scheduledVia: 'agent_tool' | 'manual';
}

/**
 * Fan-out de notificação de reunião (in-app + e-mail + webhook), único ponto
 * chamado tanto por `MeetingsService.createMeeting` (criação manual por um
 * admin, request-scoped) quanto por `AgentToolsService.scheduleMeeting`
 * (criação pela IA, singleton, sem tenant de request) — por isso este
 * serviço é singleton e fala com o banco via `DataSource` direto, não
 * `TenantTxHost`: precisa funcionar igual nos dois contextos. Mesmo
 * raciocínio de `EmailService`/`WebhookDispatchService`.
 */
@Injectable()
export class MeetingNotificationsService {
  private readonly logger = new Logger(MeetingNotificationsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly email: EmailService,
    private readonly webhookDispatch: WebhookDispatchService,
  ) {}

  /** Nunca lança — quem chama (criação da reunião) não pode ser derrubado por um canal de notificação com problema. */
  async notifyMeetingScheduled(
    meeting: MeetingScheduledNotification,
  ): Promise<void> {
    await Promise.all([
      this.notifyInApp(meeting).catch((err) =>
        this.logger.error(
          `in-app notify falhou meeting=${meeting.id}: ${(err as Error).message}`,
        ),
      ),
      this.notifyEmails(meeting).catch((err) =>
        this.logger.error(
          `email notify falhou meeting=${meeting.id}: ${(err as Error).message}`,
        ),
      ),
      this.webhookDispatch
        .emit(meeting.accountId, 'meeting.scheduled', {
          id: meeting.id,
          title: meeting.title,
          starts_at: meeting.startsAt.toISOString(),
          ends_at: meeting.endsAt?.toISOString() ?? null,
          duration_minutes: meeting.durationMinutes,
          meeting_url: meeting.meetingUrl,
          status: meeting.status,
          host_user_id: meeting.hostUserId,
          invitee_name: meeting.inviteeName,
          invitee_email: meeting.inviteeEmail,
          invitee_phone: meeting.inviteePhone,
          scheduled_via: meeting.scheduledVia,
        })
        .catch((err) =>
          this.logger.error(
            `webhook notify falhou meeting=${meeting.id}: ${(err as Error).message}`,
          ),
        ),
    ]);
  }

  private async notifyInApp(
    meeting: MeetingScheduledNotification,
  ): Promise<void> {
    if (!meeting.hostUserId) return;
    const when = new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(meeting.startsAt);
    await this.dataSource.query(
      `INSERT INTO public.notifications (account_id, user_id, kind, title, body, link_to, metadata, created_at)
       VALUES ($1, $2, 'meeting.scheduled', $3, $4, $5, $6::jsonb, now())`,
      [
        meeting.accountId,
        meeting.hostUserId,
        'Nova reunião agendada',
        `${meeting.inviteeName ?? meeting.inviteePhone ?? 'Lead'} · ${when}`,
        `/reunioes?meeting=${meeting.id}`,
        JSON.stringify({ meeting_id: meeting.id }),
      ],
    );
  }

  private async notifyEmails(
    meeting: MeetingScheduledNotification,
  ): Promise<void> {
    const when = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(meeting.startsAt);
    const linkHtml = meeting.meetingUrl
      ? `<p><a href="${meeting.meetingUrl}">Entrar na reunião (Google Meet)</a></p>`
      : '';

    const tasks: Promise<unknown>[] = [];

    if (meeting.inviteeEmail) {
      tasks.push(
        this.email.send({
          accountId: meeting.accountId,
          to: meeting.inviteeEmail,
          subject: `Reunião confirmada — ${when}`,
          html: `<p>Olá ${meeting.inviteeName ?? ''},</p><p>Sua reunião foi agendada para <strong>${when}</strong>.</p>${linkHtml}`,
        }),
      );
    }

    if (meeting.hostUserId) {
      const hostRows = await this.dataSource.query<{ email: string }[]>(
        `SELECT email FROM public.profiles WHERE id = $1`,
        [meeting.hostUserId],
      );
      const hostEmail = hostRows[0]?.email;
      if (hostEmail) {
        tasks.push(
          this.email.send({
            accountId: meeting.accountId,
            to: hostEmail,
            subject: `Nova reunião na sua agenda — ${when}`,
            html: `<p>Uma reunião com ${meeting.inviteeName ?? meeting.inviteePhone ?? 'um lead'} foi marcada para <strong>${when}</strong>.</p>${linkHtml}`,
          }),
        );
      }
    }

    await Promise.all(tasks);
  }
}

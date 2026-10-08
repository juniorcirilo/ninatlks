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
    await this.notify(meeting, 'scheduled');
  }

  /** Mesmo fan-out de `notifyMeetingScheduled`, mas com textos de "remarcada" — chamado por `MeetingsService.rescheduleMeeting`. */
  async notifyMeetingRescheduled(
    meeting: MeetingScheduledNotification,
  ): Promise<void> {
    await this.notify(meeting, 'rescheduled');
  }

  private async notify(
    meeting: MeetingScheduledNotification,
    kind: 'scheduled' | 'rescheduled',
  ): Promise<void> {
    await Promise.all([
      this.notifyInApp(meeting, kind).catch((err) =>
        this.logger.error(
          `in-app notify falhou meeting=${meeting.id}: ${(err as Error).message}`,
        ),
      ),
      this.notifyEmails(meeting, kind).catch((err) =>
        this.logger.error(
          `email notify falhou meeting=${meeting.id}: ${(err as Error).message}`,
        ),
      ),
      this.webhookDispatch
        .emit(meeting.accountId, kind === 'scheduled' ? 'meeting.scheduled' : 'meeting.rescheduled', {
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
    kind: 'scheduled' | 'rescheduled',
  ): Promise<void> {
    if (!meeting.hostUserId) return;
    const when = new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    }).format(meeting.startsAt);
    await this.dataSource.query(
      `INSERT INTO public.notifications (account_id, user_id, kind, title, body, link_to, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now())`,
      [
        meeting.accountId,
        meeting.hostUserId,
        kind === 'scheduled' ? 'meeting.scheduled' : 'meeting.rescheduled',
        kind === 'scheduled' ? 'Nova reunião agendada' : 'Reunião remarcada',
        `${meeting.inviteeName ?? meeting.inviteePhone ?? 'Lead'} · ${kind === 'scheduled' ? when : `novo horário: ${when}`}`,
        `/reunioes?meeting=${meeting.id}`,
        JSON.stringify({ meeting_id: meeting.id }),
      ],
    );
  }

  private async notifyEmails(
    meeting: MeetingScheduledNotification,
    kind: 'scheduled' | 'rescheduled',
  ): Promise<void> {
    const when = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    }).format(meeting.startsAt);
    const duration = formatDuration(meeting.durationMinutes);

    const accountRows = await this.dataSource.query<{ name: string | null }[]>(
      `SELECT name FROM public.accounts WHERE id = $1`,
      [meeting.accountId],
    );
    const accountName = accountRows[0]?.name?.trim() || 'Utalks';

    let hostName: string | null = null;
    let hostEmail: string | null = null;
    if (meeting.hostUserId) {
      const hostRows = await this.dataSource.query<
        { email: string; name: string | null; display_name: string | null }[]
      >(
        `SELECT email, name, display_name FROM public.profiles WHERE id = $1`,
        [meeting.hostUserId],
      );
      const host = hostRows[0];
      hostEmail = host?.email ?? null;
      hostName = host?.display_name?.trim() || host?.name?.trim() || null;
    }

    const tasks: Promise<unknown>[] = [];

    if (meeting.inviteeEmail) {
      tasks.push(
        this.email.send({
          accountId: meeting.accountId,
          to: meeting.inviteeEmail,
          subject:
            kind === 'scheduled'
              ? `Reunião confirmada — ${when}`
              : `Reunião remarcada — novo horário: ${when}`,
          html: buildMeetingEmailHtml({
            accountName,
            heading: kind === 'scheduled' ? 'Sua reunião foi confirmada' : 'Sua reunião foi remarcada',
            greeting: `Olá${meeting.inviteeName ? `, ${meeting.inviteeName}` : ''}!`,
            intro:
              kind === 'scheduled'
                ? `Sua reunião com ${hostName ?? accountName} está agendada. Os detalhes estão abaixo — qualquer imprevisto, é só responder este e-mail.`
                : `Sua reunião com ${hostName ?? accountName} mudou de horário. Confira os detalhes atualizados abaixo.`,
            when,
            duration,
            withLabel: hostName ? 'Com' : null,
            withName: hostName,
            meetingUrl: meeting.meetingUrl,
          }),
        }),
      );
    }

    if (hostEmail) {
      tasks.push(
        this.email.send({
          accountId: meeting.accountId,
          to: hostEmail,
          subject:
            kind === 'scheduled'
              ? `Nova reunião na sua agenda — ${when}`
              : `Reunião remarcada — novo horário: ${when}`,
          html: buildMeetingEmailHtml({
            accountName,
            heading: kind === 'scheduled' ? 'Nova reunião agendada' : 'Reunião remarcada',
            greeting: `Olá${hostName ? `, ${hostName}` : ''}!`,
            intro:
              kind === 'scheduled'
                ? `Uma reunião com ${meeting.inviteeName ?? meeting.inviteePhone ?? 'um lead'} foi adicionada à sua agenda.`
                : `A reunião com ${meeting.inviteeName ?? meeting.inviteePhone ?? 'um lead'} mudou de horário.`,
            when,
            duration,
            withLabel: 'Com',
            withName: meeting.inviteeName ?? meeting.inviteePhone ?? 'Lead',
            meetingUrl: meeting.meetingUrl,
          }),
        }),
      );
    }

    await Promise.all(tasks);
  }
}

function formatDuration(minutes: number | null): string | null {
  if (!minutes || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} minutos`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourLabel = `${hours}h`;
  return rest > 0 ? `${hourLabel}${rest}min` : `${hourLabel}${hours === 1 ? ' (1 hora)' : ''}`;
}

/**
 * E-mail de confirmação de reunião — HTML com estilos inline (tabelas, sem
 * `<style>` externo) porque é isso que sobrevive intacto na maioria dos
 * clientes de e-mail (Gmail, Outlook, apps móveis), diferente de CSS
 * moderno. Compartilhado entre o e-mail do convidado e o do host — só muda
 * o texto de saudação/intro e quem aparece como "Com".
 */
function buildMeetingEmailHtml(params: {
  accountName: string;
  heading: string;
  greeting: string;
  intro: string;
  when: string;
  duration: string | null;
  withLabel: string | null;
  withName: string | null;
  meetingUrl: string | null;
}): string {
  const { accountName, heading, greeting, intro, when, duration, withLabel, withName, meetingUrl } =
    params;

  const detailRow = (label: string, value: string) => `
    <tr>
      <td style="padding:6px 0;font-size:13px;color:#6b7280;width:110px;vertical-align:top;">${label}</td>
      <td style="padding:6px 0;font-size:14px;color:#111827;font-weight:600;">${value}</td>
    </tr>`;

  const details = [
    detailRow('Quando', capitalize(when)),
    duration ? detailRow('Duração', duration) : '',
    withLabel && withName ? detailRow(withLabel, withName) : '',
  ].join('');

  const button = meetingUrl
    ? `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr>
        <td style="border-radius:8px;background-color:#4f46e5;">
          <a href="${meetingUrl}" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">
            Entrar na reunião (Google Meet)
          </a>
        </td>
      </tr>
    </table>
    <p style="font-size:12px;color:#9ca3af;margin:0 0 24px;">
      Se o botão não funcionar, copie e cole este link no navegador:<br>
      <a href="${meetingUrl}" style="color:#4f46e5;word-break:break-all;">${meetingUrl}</a>
    </p>`
    : '';

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:32px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr>
          <td style="background-color:#111827;padding:20px 28px;">
            <span style="font-size:15px;font-weight:700;color:#ffffff;letter-spacing:0.02em;">${accountName}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 28px 8px;">
            <h1 style="margin:0 0 16px;font-size:19px;color:#111827;">${heading}</h1>
            <p style="margin:0 0 4px;font-size:14px;color:#374151;">${greeting}</p>
            <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.5;">${intro}</p>
            <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background-color:#f9fafb;border-radius:8px;padding:16px;border:1px solid #f3f4f6;">
              ${details}
            </table>
            ${button}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 28px 24px;border-top:1px solid #f3f4f6;">
            <p style="margin:0;font-size:11px;color:#9ca3af;">
              Enviado automaticamente por ${accountName} · Se você não esperava este e-mail, pode ignorá-lo com segurança.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

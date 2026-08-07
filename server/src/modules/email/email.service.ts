import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface SendEmailInput {
  accountId: string;
  to: string;
  subject: string;
  html: string;
}

const RESEND_API_URL = 'https://api.resend.com/emails';

/**
 * Envio de e-mail via API REST da Resend (fetch puro, sem SDK — mesmo estilo
 * das outras integrações externas do projeto). Singleton (não
 * REQUEST-scoped) de propósito: precisa ser chamável tanto de dentro de uma
 * requisição HTTP (MeetingsService) quanto do fluxo do agente de voz
 * (AgentToolsService, que roda fora de um tenant de request e não pode
 * injetar `SecretsService`, que é REQUEST-scoped) — por isso lê o vault
 * direto via `DataSource`, replicando a mesma query de
 * `SecretsService.getInternal`.
 *
 * Nunca lança: um e-mail que falha não pode derrubar a criação da reunião
 * que o originou — mesmo espírito do `WebhookDispatchService.emit`.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly dataSource: DataSource) {}

  async send(input: SendEmailInput): Promise<{ sent: boolean }> {
    try {
      const apiKey = await this.resolveApiKey(input.accountId);
      if (!apiKey) {
        this.logger.warn(
          `e-mail não enviado (Resend não configurado) account=${input.accountId} to=${input.to}`,
        );
        return { sent: false };
      }
      const from = process.env.RESEND_FROM_EMAIL ?? 'Nina Talks <no-reply@ninatalks.app>';
      const res = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [input.to],
          subject: input.subject,
          html: input.html,
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        this.logger.error(
          `falha ao enviar e-mail account=${input.accountId} to=${input.to}: HTTP ${res.status} ${detail}`,
        );
        return { sent: false };
      }
      return { sent: true };
    } catch (err) {
      this.logger.error(
        `falha ao enviar e-mail account=${input.accountId} to=${input.to}: ${(err as Error).message}`,
      );
      return { sent: false };
    }
  }

  private async resolveApiKey(accountId: string): Promise<string | null> {
    const rows = await this.dataSource.query<{ decrypted_secret: string }[]>(
      `SELECT vs.decrypted_secret
         FROM public.account_secrets s
         JOIN vault.decrypted_secrets vs ON vs.id = s.vault_secret_id
        WHERE s.account_id = $1 AND s.provider = 'resend' AND s.key_name = 'api_key'`,
      [accountId],
    );
    return rows[0]?.decrypted_secret ?? process.env.RESEND_API_KEY ?? null;
  }
}

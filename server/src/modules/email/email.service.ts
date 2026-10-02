import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTransport } from 'nodemailer';

export interface SendEmailInput {
  accountId: string;
  to: string;
  subject: string;
  html: string;
}

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

/**
 * Envio de e-mail via SMTP genérico (nodemailer) — funciona com qualquer
 * provedor que ofereça uma conta SMTP: Hostgator/cPanel, Gmail, Zoho, o
 * relay SMTP da própria Resend, etc. Não é acoplado a um provedor
 * específico de propósito: o cliente pode trazer o e-mail que já tem na
 * hospedagem em vez de precisar contratar outro serviço.
 *
 * Singleton (não REQUEST-scoped) de propósito: precisa ser chamável tanto
 * de dentro de uma requisição HTTP (MeetingsService) quanto do fluxo do
 * agente de voz (AgentToolsService, que roda fora de um tenant de request e
 * não pode injetar `SecretsService`, que é REQUEST-scoped) — por isso lê o
 * vault direto via `DataSource`, replicando a mesma query de
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
      const config = await this.resolveConfig(input.accountId);
      if (!config) {
        this.logger.warn(
          `e-mail não enviado (SMTP não configurado) account=${input.accountId} to=${input.to}`,
        );
        return { sent: false };
      }
      const transport = createTransport({
        host: config.host,
        port: config.port,
        secure: config.port === 465,
        auth: { user: config.user, pass: config.password },
      });
      await transport.sendMail({
        from: config.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
      });
      this.logger.log(`e-mail enviado account=${input.accountId} to=${input.to}`);
      return { sent: true };
    } catch (err) {
      this.logger.error(
        `falha ao enviar e-mail account=${input.accountId} to=${input.to}: ${(err as Error).message}`,
      );
      return { sent: false };
    }
  }

  /**
   * As credenciais SMTP podem vir por conta (coladas em Integrações → vault)
   * ou, na ausência delas, das variáveis de ambiente globais do servidor.
   */
  private async resolveConfig(accountId: string): Promise<SmtpConfig | null> {
    const rows = await this.dataSource.query<
      { key_name: string; decrypted_secret: string }[]
    >(
      `SELECT s.key_name, vs.decrypted_secret
         FROM public.account_secrets s
         JOIN vault.decrypted_secrets vs ON vs.id = s.vault_secret_id
        WHERE s.account_id = $1 AND s.provider = 'smtp'`,
      [accountId],
    );
    const stored = Object.fromEntries(rows.map((r) => [r.key_name, r.decrypted_secret]));
    const host = stored.smtp_host ?? process.env.SMTP_HOST;
    const user = stored.smtp_user ?? process.env.SMTP_USER;
    const password = stored.smtp_password ?? process.env.SMTP_PASSWORD;
    const portRaw = stored.smtp_port ?? process.env.SMTP_PORT;
    const port = Number(portRaw);
    if (!host || !user || !password || !portRaw || !Number.isFinite(port)) return null;
    const from = stored.from_email ?? process.env.SMTP_FROM_EMAIL ?? user;
    return { host, port, user, password, from };
  }
}

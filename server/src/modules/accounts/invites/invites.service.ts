import { Injectable, Scope } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DataSource } from 'typeorm';
import { TenantTxHost } from '../../../common/tenant-tx.host';
import { Invites } from '../../../database/entities/accounts/invites.entity';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable({ scope: Scope.REQUEST })
export class InvitesService {
  // `preview()` is called from a @Public() route, which TenantContextInterceptor
  // skips entirely (no req.user/req.activeAccountId to scope a transaction
  // to) — so it can't use `tx.manager` like everything else here. Goes
  // through DataSource directly instead, same pre-auth exception as
  // AuthService/SessionService.
  constructor(
    private readonly tx: TenantTxHost,
    private readonly dataSource: DataSource,
  ) {}

  async create(params: {
    accountId: string;
    email: string;
    role: string;
    invitedByUserId: string;
  }) {
    const token = randomBytes(24).toString('base64url');
    const invite = this.tx.manager.create(Invites, {
      accountId: params.accountId,
      email: params.email,
      role: params.role,
      token,
      invitedByUserId: params.invitedByUserId,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });
    return this.tx.manager.save(Invites, invite);
  }

  async listForAccount(accountId: string) {
    return this.tx.manager.find(Invites, {
      where: { accountId },
      order: { createdAt: 'DESC' },
    });
  }

  async revoke(accountId: string, inviteId: string) {
    await this.tx.manager
      .createQueryBuilder()
      .update(Invites)
      .set({ revokedAt: new Date() })
      .where('id = :inviteId AND account_id = :accountId', {
        inviteId,
        accountId,
      })
      .execute();
  }

  /** Public preview (no auth) — invite_preview() masks the email itself. */
  async preview(token: string): Promise<{
    account_name: string;
    role: string;
    email_hint: string;
    expires_at: Date;
  } | null> {
    const rows = await this.dataSource.query<
      {
        account_name: string;
        role: string;
        email_hint: string;
        expires_at: Date;
      }[]
    >(`SELECT * FROM public.invite_preview($1)`, [token]);
    return rows[0] ?? null;
  }

  /**
   * For an ALREADY-authenticated user accepting an invite to join a SECOND
   * workspace — different from AuthService.acceptInvite (new-user signup via
   * the auth.users trigger). Wraps invites_accept(), which reads auth.uid()
   * itself (i.e. the request's app.current_user_id GUC) to know who's
   * accepting. Returns the joined account_id.
   */
  async acceptAsCurrentUser(token: string): Promise<string> {
    const rows = await this.tx.manager.query<{ invites_accept: string }[]>(
      `SELECT public.invites_accept($1) AS invites_accept`,
      [token],
    );
    return rows[0].invites_accept;
  }
}

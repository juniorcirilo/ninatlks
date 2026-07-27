import { Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Sessions } from '../../database/entities/accounts/sessions.entity';

const SESSION_TTL_SECONDS = Number(
  process.env.SESSION_TTL_SECONDS ?? 60 * 60 * 24 * 30,
);

export interface ResolvedSession {
  id: string;
  userId: string;
  accountId: string | null;
}

/**
 * Deliberate exception to the "always go through TenantTxHost" rule (see
 * common/tenant-tx.host.ts): session resolution runs inside SessionStrategy,
 * which Nest invokes from a Guard — guards run BEFORE interceptors, so
 * TenantContextInterceptor hasn't opened its per-request transaction yet
 * (it needs req.user, which this service is what produces). Uses the
 * default DataSource-backed repository directly; this is the one place
 * outside common/ allowed to do that.
 */
@Injectable()
export class SessionService {
  constructor(
    @InjectRepository(Sessions) private readonly sessions: Repository<Sessions>,
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Returns the opaque token to set in the cookie — never persisted in plaintext. */
  async create(params: {
    userId: string;
    accountId?: string | null;
    userAgent?: string;
    ip?: string;
  }): Promise<string> {
    const token = `sid_${randomBytes(32).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
    await this.sessions.insert({
      tokenHash: this.hashToken(token),
      userId: params.userId,
      accountId: params.accountId ?? null,
      userAgent: params.userAgent,
      ip: params.ip,
      expiresAt,
    });
    return token;
  }

  async resolve(token: string): Promise<ResolvedSession | null> {
    const session = await this.sessions.findOne({
      where: { tokenHash: this.hashToken(token) },
    });
    if (!session) return null;
    if (session.revokedAt) return null;
    if (session.expiresAt.getTime() < Date.now()) return null;
    return {
      id: session.id,
      userId: session.userId,
      accountId: session.accountId ?? null,
    };
  }

  /** Fire-and-forget from the strategy — must never block or fail a request. */
  touchLastSeen(sessionId: string): void {
    this.sessions
      .update({ id: sessionId }, { lastSeenAt: new Date() })
      .catch(() => undefined);
  }

  async revoke(sessionId: string): Promise<void> {
    await this.sessions.update({ id: sessionId }, { revokedAt: new Date() });
  }

  /** Logout-everywhere / ban: kills every active session for the user. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.sessions
      .createQueryBuilder()
      .update(Sessions)
      .set({ revokedAt: new Date() })
      .where('user_id = :userId', { userId })
      .andWhere('revoked_at IS NULL')
      .execute();
  }
}

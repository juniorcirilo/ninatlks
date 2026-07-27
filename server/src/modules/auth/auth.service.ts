import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Profiles } from '../../database/entities/accounts/profiles.entity';
import { Invites } from '../../database/entities/accounts/invites.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { PasswordService } from './password/password.service';
import { SessionService } from './session.service';

export interface RequestMeta {
  userAgent?: string;
  ip?: string;
}

/** Raw shape returned by the auth_get_profile_by_* SECURITY DEFINER functions (snake_case DB columns). */
interface ProfileRow {
  id: string;
  email: string;
  name: string | null;
  display_name: string | null;
  availability: string;
  custom_attributes: Record<string, unknown>;
  ui_settings: Record<string, unknown>;
  confirmed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  is_super_admin: boolean;
  super_admin_onboarding_completed: boolean;
  password_hash: string | null;
  password_algo: string;
}

function mapProfileRow(row: ProfileRow): Profiles {
  const profile = new Profiles();
  profile.id = row.id;
  profile.email = row.email;
  profile.name = row.name;
  profile.displayName = row.display_name;
  profile.availability = row.availability;
  profile.customAttributes = row.custom_attributes;
  profile.uiSettings = row.ui_settings;
  profile.confirmedAt = row.confirmed_at;
  profile.createdAt = row.created_at;
  profile.updatedAt = row.updated_at;
  profile.isSuperAdmin = row.is_super_admin;
  profile.superAdminOnboardingCompleted = row.super_admin_onboarding_completed;
  profile.passwordHash = row.password_hash;
  profile.passwordAlgo = row.password_algo;
  return profile;
}

/** Raw shape returned by auth_get_invite_by_token (snake_case DB columns). */
interface InviteRow {
  id: string;
  account_id: string;
  email: string;
  role: string;
  token: string;
  invited_by_user_id: string | null;
  accepted_at: Date | null;
  accepted_by_user_id: string | null;
  revoked_at: Date | null;
  expires_at: Date;
  created_at: Date;
}

function mapInviteRow(row: InviteRow): Invites {
  const invite = new Invites();
  invite.id = row.id;
  invite.accountId = row.account_id;
  invite.email = row.email;
  invite.role = row.role;
  invite.token = row.token;
  invite.invitedByUserId = row.invited_by_user_id;
  invite.acceptedAt = row.accepted_at;
  invite.acceptedByUserId = row.accepted_by_user_id;
  invite.revokedAt = row.revoked_at;
  invite.expiresAt = row.expires_at;
  invite.createdAt = row.created_at;
  return invite;
}

/**
 * Same pre-authentication exception as SessionService/the guards in
 * common/guards: login/registration have no user yet, so they can't go
 * through TenantTxHost — they use the default DataSource/repositories
 * directly, wrapping multi-table writes (register) in their own transaction.
 *
 * `profiles` (and, for the guards, `account_users`/`user_roles`) carry RLS
 * policies keyed on `auth.uid()` (== `app.current_user_id`), which is never
 * set on this connection — there's no tenant context yet by definition. All
 * reads/writes this service does against `profiles` go through the
 * `auth_*`/SECURITY DEFINER functions added in
 * migrations/20260720100000-PreAuthRlsBypass.ts instead of the repository,
 * so they keep working under RLS instead of silently returning zero rows.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly passwordService: PasswordService,
    private readonly sessionService: SessionService,
    @InjectRepository(PasswordResetToken) private readonly resetTokens: Repository<PasswordResetToken>,
  ) {}

  private async findProfileByEmail(email: string): Promise<Profiles | null> {
    const rows = await this.dataSource.query<ProfileRow[]>(
      `SELECT * FROM public.auth_get_profile_by_email($1)`,
      [email],
    );
    return rows[0] ? mapProfileRow(rows[0]) : null;
  }

  /** `invites` SELECT policy is admin-only — the person accepting an invite isn't a member yet, let alone admin. */
  private async findInviteByToken(token: string): Promise<Invites | null> {
    const rows = await this.dataSource.query<InviteRow[]>(
      `SELECT * FROM public.auth_get_invite_by_token($1)`,
      [token],
    );
    return rows[0] ? mapInviteRow(rows[0]) : null;
  }

  private async findProfileById(id: string): Promise<Profiles | null> {
    const rows = await this.dataSource.query<ProfileRow[]>(
      `SELECT * FROM public.auth_get_profile_by_id($1)`,
      [id],
    );
    return rows[0] ? mapProfileRow(rows[0]) : null;
  }

  private async setProfilePassword(
    id: string,
    passwordHash: string,
    passwordAlgo: string,
  ): Promise<void> {
    await this.dataSource.query(
      `SELECT public.auth_set_profile_password($1, $2, $3)`,
      [id, passwordHash, passwordAlgo],
    );
  }

  async login(email: string, password: string, meta: RequestMeta) {
    const profile = await this.findProfileByEmail(email);
    if (!profile) throw new UnauthorizedException('Invalid credentials');

    const { ok, needsRehash } = await this.passwordService.verify(
      profile,
      password,
    );
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    if (needsRehash) {
      const rehashed = await this.passwordService.hash(password);
      await this.setProfilePassword(profile.id, rehashed, 'argon2');
    }

    const token = await this.sessionService.create({
      userId: profile.id,
      ...meta,
    });
    return { token, profile: this.toPublicProfile(profile) };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessionService.revoke(sessionId);
  }

  async me(userId: string) {
    const profile = await this.findProfileById(userId);
    if (!profile) throw new UnauthorizedException();
    return this.toPublicProfile(profile);
  }

  async acceptInvite(
    token: string,
    name: string,
    password: string,
    meta: RequestMeta,
  ) {
    const invite = await this.findInviteByToken(token);
    if (!invite) throw new BadRequestException('Invalid invite');
    if (invite.revokedAt) throw new BadRequestException('Invite was revoked');
    if (invite.acceptedAt)
      throw new BadRequestException('Invite already accepted');
    if (invite.expiresAt.getTime() < Date.now())
      throw new BadRequestException('Invite expired');

    const existing = await this.findProfileByEmail(invite.email);
    if (existing)
      throw new BadRequestException(
        'An account with this email already exists',
      );

    const userId = await this.createUserViaTrigger(invite.email, password, {
      name,
      invite_token: token,
    });

    const sessionToken = await this.sessionService.create({
      userId,
      accountId: invite.accountId,
      ...meta,
    });
    const profile = await this.findProfileById(userId);
    if (!profile) throw new UnauthorizedException();
    return { token: sessionToken, profile: this.toPublicProfile(profile) };
  }

  /**
   * Self-signup with no invite — same `handle_new_user()` trigger, Paths 2/3
   * (join the primary workspace as agent, or bootstrap it as admin if this
   * is the very first user). The trigger itself checks
   * system_settings.registration_enabled and raises if signups are closed.
   */
  async register(
    email: string,
    name: string,
    password: string,
    meta: RequestMeta,
  ) {
    const existing = await this.findProfileByEmail(email);
    if (existing)
      throw new BadRequestException(
        'An account with this email already exists',
      );

    let userId: string;
    try {
      userId = await this.createUserViaTrigger(email, password, { name });
    } catch (error) {
      const pgError = error as {
        code?: string;
        driverError?: { message?: string };
      };
      if (pgError?.code === 'P0001') {
        throw new BadRequestException(
          pgError.driverError?.message ?? 'Registration rejected',
        );
      }
      throw error;
    }

    const sessionToken = await this.sessionService.create({ userId, ...meta });
    const profile = await this.findProfileById(userId);
    if (!profile) throw new UnauthorizedException();
    return { token: sessionToken, profile: this.toPublicProfile(profile) };
  }

  /** First account_users membership for the user — mirrors the frontend's account-context.tsx query. */
  async primaryMembership(
    userId: string,
  ): Promise<{ accountId: string; role: 'admin' | 'agent' } | null> {
    const rows = await this.dataSource.query<
      { account_id: string; role: string | null }[]
    >(`SELECT * FROM public.auth_get_primary_membership($1)`, [userId]);
    if (!rows[0]) return null;
    return {
      accountId: rows[0].account_id,
      role: (rows[0].role as 'admin' | 'agent') ?? 'agent',
    };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const profile = await this.findProfileById(userId);
    if (!profile) throw new UnauthorizedException();
    const { ok } = await this.passwordService.verify(profile, currentPassword);
    if (!ok) throw new UnauthorizedException('Senha atual incorreta');

    const hash = await this.passwordService.hash(newPassword);
    await this.setProfilePassword(userId, hash, 'argon2');
    return { ok: true };
  }

  async forgotPassword(email: string) {
    const profile = await this.findProfileByEmail(email);
    if (!profile) return { ok: true };

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await this.resetTokens.upsert(
      { userId: profile.id, token, expiresAt },
      ['userId'],
    );

    return { ok: true, token };
  }

  async resetPassword(token: string, newPassword: string) {
    const row = await this.resetTokens.findOne({ where: { token } });
    if (!row || row.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Token inválido ou expirado');
    }

    const hash = await this.passwordService.hash(newPassword);
    await this.setProfilePassword(row.userId, hash, 'argon2');
    await this.resetTokens.delete(row.userId);
    return { ok: true };
  }

  /**
   * Inserting into auth.users (the shadow table the ~18 ported FKs still
   * point at — see the AuthSessions migration header) fires the ported
   * `handle_new_user()` trigger (its final version, from
   * supabase/migrations/20260430194150_...sql), which creates the profile
   * and — depending on raw_user_meta_data.invite_token — the right
   * account_users/user_roles too. We only add the password afterward; the
   * trigger has no concept of it.
   */
  private async createUserViaTrigger(
    email: string,
    password: string,
    rawUserMetaData: Record<string, unknown>,
  ): Promise<string> {
    const passwordHash = await this.passwordService.hash(password);
    let userId!: string;

    await this.dataSource.transaction(async (manager) => {
      const inserted = await manager.query<{ id: string }[]>(
        `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (gen_random_uuid(), $1, $2) RETURNING id`,
        [email, JSON.stringify(rawUserMetaData)],
      );
      userId = inserted[0].id;
      await manager.update(
        Profiles,
        { id: userId },
        { passwordHash, passwordAlgo: 'argon2' },
      );
    });

    return userId;
  }

  private toPublicProfile(profile: Profiles) {
    return {
      id: profile.id,
      email: profile.email,
      name: profile.name,
      displayName: profile.displayName,
      availability: profile.availability,
      isSuperAdmin: profile.isSuperAdmin,
      createdAt: profile.createdAt,
    };
  }
}

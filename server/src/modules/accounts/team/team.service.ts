import { Injectable, Scope } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { TenantTxHost } from '../../../common/tenant-tx.host';
import { PasswordService } from '../../auth/password/password.service';
import { SessionService } from '../../auth/session.service';

export interface TeamMember {
  user_id: string;
  email: string;
  name: string;
  role: 'admin' | 'agent';
  joined_at: Date;
}

/**
 * Thin wrapper over the ported SQL functions (team_list_members,
 * team_change_role, team_remove_member) — they're SECURITY DEFINER and
 * already do their own authorization via auth.uid()/has_role() internally,
 * so this service doesn't duplicate that logic in TypeScript. Route guards
 * (AccountMemberGuard/RolesGuard) are still the first line of defense.
 */
@Injectable({ scope: Scope.REQUEST })
export class TeamService {
  constructor(
    private readonly tx: TenantTxHost,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  async listMembers(accountId: string): Promise<TeamMember[]> {
    return this.tx.manager.query(`SELECT * FROM public.team_list_members($1)`, [
      accountId,
    ]);
  }

  async changeRole(
    accountId: string,
    targetUserId: string,
    newRole: 'admin' | 'agent',
  ): Promise<void> {
    await this.tx.manager.query(
      `SELECT public.team_change_role($1, $2, $3::app_role)`,
      [accountId, targetUserId, newRole],
    );
  }

  async removeMember(accountId: string, targetUserId: string): Promise<void> {
    await this.tx.manager.query(`SELECT public.team_remove_member($1, $2)`, [
      accountId,
      targetUserId,
    ]);
  }

  async updateMember(
    accountId: string,
    targetUserId: string,
    name: string,
    email: string,
  ): Promise<void> {
    await this.tx.manager.query(
      `SELECT public.team_update_member($1, $2, $3, $4)`,
      [accountId, targetUserId, name, email],
    );
  }

  /**
   * Define a senha do membro (ou gera uma aleatória) e derruba as sessões
   * ativas dele. A senha gerada só é devolvida nesta resposta.
   */
  async setPassword(
    accountId: string,
    targetUserId: string,
    password?: string,
  ): Promise<{ password: string; generated: boolean }> {
    const generated = !password;
    const plain = password ?? generatePassword();
    const hash = await this.passwords.hash(plain);
    await this.tx.manager.query(
      `SELECT public.team_set_member_password($1, $2, $3, 'argon2')`,
      [accountId, targetUserId, hash],
    );
    await this.sessions.revokeAllForUser(targetUserId);
    return { password: plain, generated };
  }
}

// Sem caracteres ambíguos (0/O, 1/l/I) para facilitar ditar/copiar.
const PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function generatePassword(length = 14): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  }
  return out;
}

import { Injectable, Scope } from '@nestjs/common';
import { TenantTxHost } from '../../../common/tenant-tx.host';

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
  constructor(private readonly tx: TenantTxHost) {}

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
}

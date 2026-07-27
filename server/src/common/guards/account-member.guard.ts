import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AuthenticatedRequest } from '../types/authenticated-request';

/**
 * Equivalent to is_account_member(auth.uid(), account_id) — same deliberate
 * exception as SessionService: runs as a Guard (before
 * TenantContextInterceptor opens its transaction), so it queries directly
 * instead of going through TenantTxHost. Reads account_id from the route
 * param and sets req.activeAccountId, which the interceptor then uses for
 * `SET LOCAL app.current_account_id`.
 *
 * Goes through the `guard_check_account_membership` SECURITY DEFINER
 * function (migrations/20260720100000-PreAuthRlsBypass.ts) rather than a
 * plain repository query: `account_users` has RLS keyed on `auth.uid()`,
 * which is never set on this connection (there's no tenant context yet —
 * establishing it is this guard's whole job), so a plain query silently
 * returned zero rows for every account once RLS was actually enforced
 * (previously masked by the app DB role being superuser).
 */
@Injectable()
export class AccountMemberGuard implements CanActivate {
  constructor(private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.user) throw new UnauthorizedException();

    const rawAccountId = req.params?.accountId;
    const accountId = Array.isArray(rawAccountId)
      ? rawAccountId[0]
      : rawAccountId;
    if (!accountId) {
      throw new ForbiddenException(
        'Route is missing :accountId — AccountMemberGuard has nothing to check',
      );
    }

    const rows = await this.dataSource.query<{ guard_check_account_membership: boolean }[]>(
      `SELECT public.guard_check_account_membership($1, $2)`,
      [req.user.id, accountId],
    );
    if (!rows[0]?.guard_check_account_membership)
      throw new ForbiddenException('Not a member of this account');

    req.activeAccountId = accountId;
    return true;
  }
}

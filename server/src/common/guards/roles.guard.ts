import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedRequest } from '../types/authenticated-request';

/**
 * Equivalent to has_role(auth.uid(), account_id, role). Must run AFTER
 * AccountMemberGuard (needs req.activeAccountId already set) — order guards
 * with @UseGuards(SessionAuthGuard, AccountMemberGuard, RolesGuard).
 *
 * Goes through the `guard_get_user_roles` SECURITY DEFINER function
 * (migrations/20260720100000-PreAuthRlsBypass.ts) rather than a plain
 * repository query — `user_roles` has RLS keyed on `auth.uid()`, which is
 * never set on this pre-tenant-context connection (same reasoning as
 * AccountMemberGuard).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.user) throw new UnauthorizedException();
    if (!req.activeAccountId) {
      throw new ForbiddenException(
        'RolesGuard requires an active account — run AccountMemberGuard first',
      );
    }

    const roles = await this.dataSource.query<{ role: string }[]>(
      `SELECT * FROM public.guard_get_user_roles($1, $2)`,
      [req.user.id, req.activeAccountId],
    );
    const hasRole = roles.some((r) => required.includes(r.role));
    if (!hasRole)
      throw new ForbiddenException(
        `Requires one of roles: ${required.join(', ')}`,
      );
    return true;
  }
}

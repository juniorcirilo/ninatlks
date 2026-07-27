import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../types/authenticated-request';

/**
 * Set by AccountMemberGuard (common/guards) after validating the caller belongs
 * to the account referenced by the request (path param, body, or session default).
 */
export const CurrentAccount = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.activeAccountId;
  },
);

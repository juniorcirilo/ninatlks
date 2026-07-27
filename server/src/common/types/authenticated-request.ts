import type { Request } from 'express';

export interface RequestUser {
  id: string;
  sessionId: string;
}

/**
 * Populated in two steps: AuthGuard('session') sets `user`, AccountMemberGuard
 * (running after it, per-route) sets `activeAccountId` once it validates
 * membership for the account_id referenced by the route.
 */
export interface AuthenticatedRequest extends Request {
  user: RequestUser;
  activeAccountId: string;
}

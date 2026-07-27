import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Equivalent to has_role(auth.uid(), account_id, role) in the current Supabase RLS.
 * Checked by RolesGuard against account_users for the active account.
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

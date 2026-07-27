import { BadRequestException } from '@nestjs/common';

/**
 * Several ported SQL functions (team_change_role, team_remove_member,
 * handle_new_user, ...) enforce business rules via `RAISE EXCEPTION` —
 * Postgres surfaces these as a plain error with code 'P0001' and the
 * exception text as the message. Translates that into a 400 with the
 * original (already user-facing, Portuguese) message instead of a generic
 * 500. Rethrows anything else unchanged.
 */
export function translatePgException(error: unknown): never {
  const pgError = error as {
    code?: string;
    message?: string;
    driverError?: { message?: string };
  };
  if (pgError?.code === 'P0001') {
    const message =
      pgError.driverError?.message ?? pgError.message ?? 'Request rejected';
    throw new BadRequestException(message);
  }
  throw error as Error;
}

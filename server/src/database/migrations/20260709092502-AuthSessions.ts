import { MigrationInterface, QueryRunner } from 'typeorm';

// First hand-written migration (Fase 3, auth) — everything before this
// timestamp is a 1:1 port of the historical Supabase migrations. Adds the
// new backend's own auth storage: password credentials on `profiles` (the
// table already used everywhere as "the user", 1:1 with the now-decommissioned
// auth.users) and an opaque server-side `sessions` table (see
// modules/auth/session.service.ts). `auth.users` is kept as a minimal shadow
// row per profile purely so the ~18 existing FKs to auth.users(id) across the
// ported schema keep working — UsersService inserts into both tables.
export class AuthSessions20260709092502 implements MigrationInterface {
  name = 'AuthSessions20260709092502';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.profiles
        ADD COLUMN IF NOT EXISTS password_hash text,
        ADD COLUMN IF NOT EXISTS password_algo text NOT NULL DEFAULT 'argon2';
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.sessions (
        id bigserial PRIMARY KEY,
        token_hash text NOT NULL UNIQUE,
        user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
        account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
        user_agent text,
        ip inet,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON public.sessions(token_hash);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_user_active ON public.sessions(user_id) WHERE revoked_at IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.sessions;`);
    await queryRunner.query(`
      ALTER TABLE public.profiles
        DROP COLUMN IF EXISTS password_hash,
        DROP COLUMN IF EXISTS password_algo;
    `);
  }
}

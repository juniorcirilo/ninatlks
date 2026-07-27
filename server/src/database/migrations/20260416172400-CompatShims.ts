import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from scripts/db/00-compat-shims.sql.
export class CompatShims20260416172400 implements MigrationInterface {
  name = 'CompatShims20260416172400';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- Compatibility shims so the 142 Supabase-generated migrations in
-- supabase/migrations/ can be replayed as-is against a plain self-hosted
-- Postgres, for the sole purpose of schema introspection (generating
-- TypeORM entities). This is NOT meant to be functionally complete or
-- secure — cron/net/vault below are inert stand-ins, not real
-- implementations. Runs once, before the 142 files, via
-- scripts/db/apply-supabase-migrations.sh.
--
-- Real replacements for cron (BullMQ), net (server-side HTTP calls) and
-- vault (secrets module) are built in later phases (see supabase-migration
-- plan, Fases 6-8) — this file only exists to make \`CREATE EXTENSION\`/
-- \`cron.schedule\`/\`net.http_post\`/\`vault.*\` calls inside the historical
-- migrations not blow up the replay.

-- Supabase/PostgREST roles: ~63 policies target \`TO authenticated\`, 25 grant
-- to \`service_role\`, 5 to \`anon\`. RLS's \`TO role\` matches by role
-- MEMBERSHIP (pg_has_role), so granting these to the app's connection user
-- (not switching into them per-request) is enough for every existing policy
-- to apply exactly as before. service_role gets BYPASSRLS to match Supabase
-- (used by a handful of SECURITY DEFINER admin paths).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;
`);
    await queryRunner.query(`
GRANT anon, authenticated, service_role TO CURRENT_USER;
`);
    await queryRunner.query(`
-- Real extensions (available in the pgvector/pgvector:pg16 image).
CREATE EXTENSION IF NOT EXISTS pgcrypto;
`);
    await queryRunner.query(`
CREATE EXTENSION IF NOT EXISTS pg_trgm;
`);
    await queryRunner.query(`
CREATE EXTENSION IF NOT EXISTS vector;
`);
    await queryRunner.query(`
-- auth.uid() — see server/src/database/migrations/1783593624000-AuthUidCompat.ts
-- for the permanent version of this shim (reads app.current_user_id, the GUC
-- TenantContextInterceptor sets per-request instead of PostgREST's JWT claim).
CREATE SCHEMA IF NOT EXISTS auth;
`);
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sign_in_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`);
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('app.current_user_id', true), '')::uuid
$$;
`);
    await queryRunner.query(`
-- cron.* — real schedules are ported to BullMQ (Fase 7). No-op stand-ins so
-- \`cron.schedule(...)\`/\`cron.unschedule(...)\` calls in migrations succeed.
CREATE SCHEMA IF NOT EXISTS cron;
`);
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS cron.job (
  jobid bigserial PRIMARY KEY,
  jobname text UNIQUE,
  schedule text,
  command text,
  active boolean NOT NULL DEFAULT true
);
`);
    await queryRunner.query(`
-- Real pg_cron's run-history table (columns per pg_cron docs) — always empty
-- here since nothing actually executes these jobs locally, but some
-- migrations query it (e.g. an admin view of last-run status).
CREATE TABLE IF NOT EXISTS cron.job_run_details (
  runid bigserial PRIMARY KEY,
  jobid bigint,
  job_pid int,
  database text,
  username text,
  command text,
  status text,
  return_message text,
  start_time timestamptz,
  end_time timestamptz
);
`);
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION cron.schedule(job_name text, schedule text, command text)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO cron.job (jobname, schedule, command)
  VALUES (job_name, schedule, command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING jobid INTO v_id;
  RETURN v_id;
END;
$$;
`);
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION cron.schedule(schedule text, command text)
RETURNS bigint
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN cron.schedule(md5(schedule || command), schedule, command);
END;
$$;
`);
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION cron.unschedule(job_name text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM cron.job WHERE jobname = job_name;
  RETURN true;
END;
$$;
`);
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION cron.unschedule(job_id bigint)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM cron.job WHERE jobid = job_id;
  RETURN true;
END;
$$;
`);
    await queryRunner.query(`
-- net.* — real outbound HTTP calls are made from NestJS services directly.
-- No-op stand-in so \`net.http_post(...)\` calls in migrations succeed.
CREATE SCHEMA IF NOT EXISTS net;
`);
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION net.http_post(
  url text,
  body jsonb DEFAULT '{}'::jsonb,
  params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{}'::jsonb,
  timeout_milliseconds int DEFAULT 5000
)
RETURNS bigint
LANGUAGE sql
AS $$
  SELECT 0::bigint
$$;
`);
    await queryRunner.query(`
-- vault.* — real secrets module ported to Postgres-backed storage in a Nest
-- module (Fase 1/8, secrets/vault.service.ts), NOT the real supabase_vault
-- extension (pgsodium-encrypted, Supabase-platform-only). This stand-in
-- stores secrets in PLAIN TEXT — fine for local schema introspection only,
-- never point this at anything with real credentials.
CREATE SCHEMA IF NOT EXISTS vault;
`);
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS vault.secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  description text NOT NULL DEFAULT '',
  secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`);
    await queryRunner.query(`
CREATE OR REPLACE VIEW vault.decrypted_secrets AS
  SELECT id, name, description, secret AS decrypted_secret, created_at, updated_at
  FROM vault.secrets;
`);
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION vault.create_secret(secret text, name text DEFAULT NULL, description text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO vault.secrets (secret, name, description)
  VALUES (secret, name, coalesce(description, ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
`);
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION vault.update_secret(
  id uuid,
  new_secret text DEFAULT NULL,
  new_name text DEFAULT NULL,
  new_description text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE vault.secrets
  SET secret = coalesce(new_secret, secret),
      name = coalesce(new_name, name),
      description = coalesce(new_description, description),
      updated_at = now()
  WHERE vault.secrets.id = update_secret.id;
END;
$$;
`);
    await queryRunner.query(`
-- storage.* — real storage moves to MinIO (Fase 5). Minimal stand-in so
-- \`storage.buckets\`/\`storage.objects\` inserts + \`storage.foldername()\`
-- (used by RLS policies keyed on "<accountId>/...") succeed.
CREATE SCHEMA IF NOT EXISTS storage;
`);
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
`);
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
`);
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION storage.foldername(name text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$$;
`);
    await queryRunner.query(`
-- supabase_realtime publication — Supabase platform creates this outside the
-- migrations; the 142 files only ALTER it (ADD TABLE ...), assuming it
-- exists already.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'CompatShims20260416172400 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}

#!/usr/bin/env node
// One-time generator: wraps the 142 Supabase-generated SQL migrations
// (supabase/migrations/*.sql) — plus scripts/db/00-compat-shims.sql, which
// must run first — as individual TypeORM migration files in
// server/src/database/migrations/, so `npm run migration:run` (inside
// server/) applies them with normal TypeORM tracking instead of a bespoke
// psql shell loop. Re-run is safe: it always regenerates the same files from
// the same SQL sources.
//
// Timestamp scheme: Supabase filenames are already `YYYYMMDDHHMMSS_slug.sql`
// and TypeORM sorts migrations by the numeric prefix, so we keep that prefix
// as-is (preserves exact original order) and give the compat shims a
// timestamp one second before the earliest real migration so it always runs
// first. Any future hand-written migration (Fase 3+) should use a *current*
// `YYYYMMDDHHMMSS` timestamp — that will naturally sort after all of these
// since they're all dated 2026-04 through 2026-06.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const SUPABASE_MIGRATIONS_DIR = join(REPO_ROOT, 'supabase', 'migrations');
const COMPAT_SHIMS_FILE = join(__dirname, '00-compat-shims.sql');
const OUT_DIR = join(REPO_ROOT, 'server', 'src', 'database', 'migrations');

mkdirSync(OUT_DIR, { recursive: true });

// CREATE EXTENSION for pg_cron/pg_net/supabase_vault fails outside Supabase's
// platform — the compat shims stand up equivalent schemas/functions instead,
// so these specific lines are stripped when porting (the original file in
// supabase/migrations/ is never touched).
const STRIP_EXTENSION_RE = /^\s*create\s+extension\b.*(pg_cron|pg_net|supabase_vault).*$/gim;

// Pre-existing bugs in specific historical migration files, discovered by
// actually replaying them against a fresh Postgres (something that, as far
// as we can tell, was never done before — Lovable/Supabase Cloud applies
// migrations incrementally against an already-live database, which can mask
// an ordering bug like this one). Patches apply ONLY to the ported TypeORM
// file; supabase/migrations/*.sql is never modified.
const KNOWN_FIXES = {
  '20260428190206_54dac6cc-05ff-4bfa-88c8-60857ae68157.sql': (sql) => {
    // Same audit_log/entity_type bug as lgpd_delete_contact (see the fix
    // below for 20260420015933) — set_account_secret() only populates the
    // legacy resource_type/resource_id columns.
    const needle = `  INSERT INTO public.audit_log (account_id, user_id, action, resource_type, resource_id, metadata)
  VALUES (p_account_id, auth.uid(), 'secret_set', 'account_secret',
          format('%s/%s', p_provider, p_key_name),
          jsonb_build_object('provider', p_provider, 'key_name', p_key_name));`;
    if (!sql.includes(needle)) {
      throw new Error('KNOWN_FIXES patch target not found (set_account_secret audit_log) — migration content changed?');
    }
    const fixed = `  INSERT INTO public.audit_log (account_id, user_id, actor_id, action, entity_type, entity_id, resource_type, resource_id, metadata)
  VALUES (p_account_id, auth.uid(), auth.uid(), 'secret_set', 'account_secret', format('%s/%s', p_provider, p_key_name),
          'account_secret',
          format('%s/%s', p_provider, p_key_name),
          jsonb_build_object('provider', p_provider, 'key_name', p_key_name));`;
    return sql.replace(needle, () => fixed);
  },

  '20260424164850_1168a47b-f138-47ea-9e5b-e8d7c6306ade.sql': (sql) => {
    // Same audit_log/entity_type bug, in delete_account_secret() this time.
    const needle = `  INSERT INTO public.audit_log (account_id, user_id, action, resource_type, resource_id, metadata)
  VALUES (p_account_id, auth.uid(), 'secret_deleted', 'account_secret',
          format('%s/%s', p_provider, p_key_name),
          jsonb_build_object('provider', p_provider, 'key_name', p_key_name));`;
    if (!sql.includes(needle)) {
      throw new Error('KNOWN_FIXES patch target not found (delete_account_secret audit_log) — migration content changed?');
    }
    const fixed = `  INSERT INTO public.audit_log (account_id, user_id, actor_id, action, entity_type, entity_id, resource_type, resource_id, metadata)
  VALUES (p_account_id, auth.uid(), auth.uid(), 'secret_deleted', 'account_secret', format('%s/%s', p_provider, p_key_name),
          'account_secret',
          format('%s/%s', p_provider, p_key_name),
          jsonb_build_object('provider', p_provider, 'key_name', p_key_name));`;
    return sql.replace(needle, () => fixed);
  },

  '20260420015933_2bc66674-c370-410d-9cbc-6f6a4905895f.sql': (sql) => {
    // lgpd_delete_contact()'s audit_log insert only sets the legacy
    // resource_type/resource_id/user_id columns — audit_log's schema was
    // later hardened (20260416210500_schema_hardening.sql) to require
    // entity_type NOT NULL, and this function was never updated to match.
    // Fails with "null value in column entity_type" the first time it's
    // actually invoked, in production too.
    const needle = `  INSERT INTO public.audit_log (account_id, user_id, action, resource_type, resource_id, metadata)
  VALUES (v_account_id, auth.uid(), 'lgpd_delete', 'contact', p_contact_id::text,
          jsonb_build_object('deleted_at', now()));`;
    if (!sql.includes(needle)) {
      throw new Error('KNOWN_FIXES patch target not found (lgpd_delete_contact audit_log) — migration content changed?');
    }
    const fixed = `  INSERT INTO public.audit_log (account_id, user_id, actor_id, action, entity_type, entity_id, resource_type, resource_id, metadata)
  VALUES (v_account_id, auth.uid(), auth.uid(), 'lgpd_delete', 'contact', p_contact_id::text, 'contact', p_contact_id::text,
          jsonb_build_object('deleted_at', now()));`;
    return sql.replace(needle, () => fixed);
  },

  '20260416233524_06f0f69f-a028-4dd3-8fe2-b7b46d15d1c4.sql': (sql) => {
    // Same bug, twice in this file: `create table if not exists X (...)` is a
    // silent no-op because 20260416210500_schema_hardening.sql already
    // created both `companies` and `audit_log` earlier with a different,
    // narrower column set. The extra columns this file assumes exist (and
    // immediately indexes) were therefore never actually added.
    const patches = [
      {
        needle:
          'create index if not exists companies_domain_idx on public.companies(account_id, domain);',
        patch: `alter table public.companies
  add column if not exists domain text,
  add column if not exists size text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;
`,
      },
      {
        needle: 'create index if not exists audit_log_account_created_idx',
        patch: `alter table public.audit_log
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists resource_type text,
  add column if not exists resource_id text,
  add column if not exists ip_address text,
  add column if not exists user_agent text;
`,
      },
    ];
    let patched = sql;
    for (const { needle, patch } of patches) {
      if (!patched.includes(needle)) {
        throw new Error(`KNOWN_FIXES patch target not found (${needle.slice(0, 40)}...) — migration content changed?`);
      }
      patched = patched.replace(needle, () => `${patch}\n${needle}`);
    }
    return patched;
  },

  '20260419120000_sprint3_embeddings.sql': (sql) => {
    // `incident_find_similar()` (a LANGUAGE sql function, validated eagerly
    // at CREATE time) references incident_clusters.embedding, but the ALTER
    // TABLE that adds that column appears further down in the same file —
    // reorder so the column exists before the function referencing it.
    const block = `alter table public.incident_clusters
  add column if not exists embedding vector(1536),
  add column if not exists member_count integer default 0;
`;
    if (!sql.includes(block)) {
      throw new Error('KNOWN_FIXES patch target not found (incident_clusters ALTER) — migration content changed?');
    }
    const withoutBlock = sql.replace(block, '');
    let patched = `${block}\n${withoutBlock}`;

    // incident_clusters.id is `bigint generated always as identity`
    // (20260416181116_...sql:28), not uuid — incident_find_similar()
    // declares `returns table (cluster_id uuid, ...)`, a genuine type bug in
    // the original migration (Postgres validates a LANGUAGE sql function's
    // final SELECT against its declared return type at CREATE time).
    const badReturn = 'returns table (\n  cluster_id uuid,';
    const goodReturn = 'returns table (\n  cluster_id bigint,';
    if (!patched.includes(badReturn)) {
      throw new Error('KNOWN_FIXES patch target not found (incident_find_similar return type) — migration content changed?');
    }
    patched = patched.replace(badReturn, () => goodReturn);
    return patched;
  },

  '20260420015458_b2b5c201-7515-4239-b8ee-ec5994ed12b4.sql': (sql) => {
    // Redefines nexus_cron_status() with a different RETURNS TABLE shape
    // than 20260419110000_sprint2_crons.sql — Postgres requires DROP
    // FUNCTION first when a CREATE OR REPLACE changes the return type. Same
    // issue one statement later for the nexus_cron_jobs view built on top of
    // it (CREATE OR REPLACE VIEW can't change the view's column set either).
    const fnNeedle = 'CREATE OR REPLACE FUNCTION public.nexus_cron_status()';
    const viewNeedle = 'CREATE OR REPLACE VIEW public.nexus_cron_jobs AS';
    if (!sql.includes(fnNeedle) || !sql.includes(viewNeedle)) {
      throw new Error('KNOWN_FIXES patch target not found (nexus_cron_status/nexus_cron_jobs) — migration content changed?');
    }
    return sql
      .replace(fnNeedle, () => `DROP FUNCTION IF EXISTS public.nexus_cron_status();\n\n${fnNeedle}`)
      .replace(viewNeedle, () => `DROP VIEW IF EXISTS public.nexus_cron_jobs;\n\n${viewNeedle}`);
  },

  '20260420021021_c5769db7-c79a-47ef-b0cf-314cdafcbcad.sql': (sql) => {
    // Same no-op-CREATE-TABLE bug, twice in this file:
    // 20260419150000_voice_campaigns.sql already created voice_campaigns AND
    // voice_campaign_contacts with earlier column sets; this file's
    // redesigned `CREATE TABLE IF NOT EXISTS` for both is a no-op, so the
    // redesigned columns it immediately indexes/uses were never added.
    const patches = [
      {
        needle:
          "CREATE INDEX IF NOT EXISTS idx_voice_campaigns_scheduled ON public.voice_campaigns(status, scheduled_at) WHERE status IN ('scheduled','running');",
        patch: `ALTER TABLE public.voice_campaigns
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'script_readback' CHECK (mode IN ('script_readback','conversational')),
  ADD COLUMN IF NOT EXISTS from_number text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS escalation_target_number text,
  ADD COLUMN IF NOT EXISTS escalation_keywords jsonb NOT NULL DEFAULT '["atendente","humano","gerente","supervisor","operador","representante"]'::jsonb,
  ADD COLUMN IF NOT EXISTS max_concurrent integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS retry_attempts integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS retry_delay_minutes integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS total_contacts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_by_id uuid;
`,
      },
      {
        needle:
          "CREATE INDEX IF NOT EXISTS idx_vcc_dispatch_queue ON public.voice_campaign_contacts(status, next_retry_at) WHERE status IN ('queued');",
        // voice_call_id already exists (uuid, from the first definition) —
        // left alone rather than reconciled against this file's conflicting
        // `bigint` redefinition, since ADD COLUMN IF NOT EXISTS can't change
        // an existing column's type and which one matches real production
        // data can't be determined from the migration history alone.
        patch: `ALTER TABLE public.voice_campaign_contacts
  ADD COLUMN IF NOT EXISTS to_number text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_call_sid text,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
`,
      },
    ];
    let patched = sql;
    for (const { needle, patch } of patches) {
      if (!patched.includes(needle)) {
        throw new Error(`KNOWN_FIXES patch target not found (${needle.slice(0, 40)}...) — migration content changed?`);
      }
      patched = patched.replace(needle, () => `${patch}\n${needle}`);
    }
    return patched;
  },

  '20260420100000_workflow_engine.sql': (sql) => {
    // Same no-op-CREATE-TABLE bug, twice: 20260420022744_...sql already
    // created both workflows and workflow_events with earlier column sets.
    const patches = [
      {
        needle: `create index if not exists idx_workflow_events_unprocessed
  on public.workflow_events(account_id, received_at)
  where processed_at is null;`,
        patch: `alter table public.workflow_events
  add column if not exists provider text,
  add column if not exists dedup_key text,
  add column if not exists error text,
  add column if not exists received_at timestamptz not null default now();
`,
      },
      {
        // workflows already has a plain `trigger_type text` column from the
        // earlier definition — this file's generated-column version of
        // trigger_type is silently skipped (harmless: the plain column just
        // won't auto-derive from `trigger` jsonb). Only add what's missing.
        needle: `    set run_count = run_count + 1,`,
        patch: `alter table public.workflows
  add column if not exists trigger jsonb not null default '{}'::jsonb,
  add column if not exists last_run_status text,
  add column if not exists run_count integer not null default 0;
`,
        // This needle is inside a plpgsql function body further down the
        // file — insert the ALTER right before the function definition that
        // contains it instead of splicing mid-body.
        insertBeforeContaining: 'create or replace function',
      },
      {
        // Same no-op-CREATE-TABLE bug a third time: contact_tags already
        // exists from 20260420022744_...sql with a narrower column set
        // (created_by_id, no added_by). This file's `create table if not
        // exists` redefinition is skipped, so `added_by` — referenced by
        // tg_tag_added_into_workflow_events() below — was never added.
        needle: '-- contact.tag_added',
        patch: `alter table public.contact_tags
  add column if not exists added_by uuid;
`,
      },
    ];
    let patched = sql;
    for (const { needle, patch, insertBeforeContaining } of patches) {
      if (!patched.includes(needle)) {
        throw new Error(`KNOWN_FIXES patch target not found (${needle.slice(0, 40)}...) — migration content changed?`);
      }
      if (insertBeforeContaining) {
        const stmtStart = patched.lastIndexOf(insertBeforeContaining, patched.indexOf(needle));
        patched = patched.slice(0, stmtStart) + patch + '\n' + patched.slice(stmtStart);
      } else {
        patched = patched.replace(needle, () => `${patch}\n${needle}`);
      }
    }
    return patched;
  },

  '20260420140000_integrations.sql': (sql) => {
    // `days_overdue` is declared `GENERATED ALWAYS AS (... now() ...) STORED`
    // — Postgres requires generation expressions to be IMMUTABLE, and now()
    // is STABLE, so this CREATE TABLE fails outright (never a valid
    // definition, regardless of replay order). Ported as a plain nullable
    // column instead; computing "days overdue" belongs in application code
    // or a view, not a stored generated column, given it depends on now().
    const needle = `  days_overdue integer generated always as (
    case when due_at is not null and paid_at is null
      then greatest(0, extract(days from (now() - due_at))::int)
      else 0
    end
  ) stored,`;
    if (!sql.includes(needle)) {
      throw new Error('KNOWN_FIXES patch target not found (days_overdue) — migration content changed?');
    }
    return sql.replace(needle, () => '  days_overdue integer,');
  },

  '20260420150000_crm_sync.sql': (sql) => {
    // `for t in select unnest(...) loop` inside an anonymous DO block with no
    // `declare t text;` — plpgsql requires the loop variable to be declared
    // (as record or a scalar matching the query shape) when the loop body
    // isn't a bare `for t in query loop ... end loop` at the top level of a
    // function with an implicit record var; inside `do $$ begin ... end $$`
    // with no DECLARE section, `t` is never introduced.
    const needle = 'do $$\nbegin\n  for t in select unnest(';
    if (!sql.includes(needle)) {
      throw new Error('KNOWN_FIXES patch target not found (crm_sync loop var) — migration content changed?');
    }
    // Function replacer: a string replacement would have `$$` reinterpreted
    // as the special "insert one literal $" pattern (String#replace
    // replacement-string syntax), corrupting the dollar-quote delimiter.
    return sql.replace(needle, () => 'do $$\ndeclare\n  t text;\nbegin\n  for t in select unnest(');
  },

  '20260423224300_256f11e9-d7f7-41de-9ef9-09fd4b84cbf6.sql': (sql) => {
    // script_mode already carries an inline CHECK from its original CREATE
    // TABLE (20260419150000_voice_campaigns.sql), auto-named by Postgres as
    // `voice_campaigns_script_mode_check` — the exact name this migration's
    // `ADD CONSTRAINT` reuses, so it collides. The file already does
    // `DROP CONSTRAINT IF EXISTS` first for the two other constraints it
    // touches (voice_campaigns_mode_check, voice_campaigns_status_check);
    // this one was just missed.
    const needle = `ALTER TABLE public.voice_campaigns
  ADD CONSTRAINT voice_campaigns_script_mode_check`;
    if (!sql.includes(needle)) {
      throw new Error('KNOWN_FIXES patch target not found (voice_campaigns_script_mode_check) — migration content changed?');
    }
    return sql.replace(
      needle,
      () =>
        `ALTER TABLE public.voice_campaigns DROP CONSTRAINT IF EXISTS voice_campaigns_script_mode_check;\n${needle}`,
    );
  },

  '20260426232138_08b8bfee-c878-48f1-8bf8-0899a8137e1c.sql': (sql) => {
    // Unlike every other migration that touches supabase_realtime (which
    // guards with a `where pubname=... and tablename=...` existence check
    // before ALTER PUBLICATION ADD TABLE), this file does it unconditionally
    // — messages/conversations were already added to the publication by an
    // earlier migration, so this errors on replay.
    const needle = `ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;`;
    if (!sql.includes(needle)) {
      throw new Error('KNOWN_FIXES patch target not found (messages/conversations publication) — migration content changed?');
    }
    const guarded = ['messages', 'conversations']
      .map(
        (t) => `DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = '${t}'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.${t}';
  END IF;
END $guard$;`,
      )
      .join('\n');
    return sql.replace(needle, () => guarded);
  },

  '20260429204031_719021b7-8b53-44a1-9716-e05c87ebe9ef.sql': () =>
    // Pure data backfill for one specific hardcoded real account_id
    // ('ca3a4cd2-...', doesn't exist on a fresh schema-only replay) — no
    // schema impact, safe to no-op for local introspection.
    '-- [no-op for local introspection: data backfill for a specific real account_id, no schema impact]\nSELECT 1;',

  '20260421240000_contacts_dedup.sql': (sql) => {
    // merge_contacts() has two independent bugs, both found by actually
    // invoking it (never done before, same as the rest of the KNOWN_FIXES
    // in this file):
    //
    // 1. References contacts.avatar_url, a column never added by any
    //    migration (grep across the whole supabase/migrations tree finds
    //    this exact string only here) — fails with "column avatar_url does
    //    not exist" the first time it's invoked, in production too.
    //
    // 2. Merges the primary's name/phone_number/email/custom_attributes
    //    from the duplicates' rows BEFORE deleting the duplicates — if the
    //    primary and a duplicate share a non-null email or identifier, the
    //    UPDATE trips contacts_account_id_email_key /
    //    uniq_contacts_account_identifier (both rows briefly hold the same
    //    value at once). Fix: capture the coalesced values into variables
    //    first, delete the duplicates, THEN write the primary — exactly
    //    the ordering the original author clearly intended ("Finally drop
    //    the duplicates" was written last, but unique constraints don't
    //    wait for "finally").
    const declareNeedle = `  v_moved_convs int := 0;
  v_moved_cis int := 0;
begin`;
    const declareFixed = `  v_moved_convs int := 0;
  v_moved_cis int := 0;
  v_merged_name text;
  v_merged_phone text;
  v_merged_email text;
  v_merged_custom_attrs jsonb;
begin`;

    const mergeNeedle = `  -- Union of custom_attributes (primary wins on keys that already exist).
  update public.contacts p
     set custom_attributes = coalesce(p.custom_attributes, '{}'::jsonb)
                         || (
                              select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
                              from (
                                select d.custom_attributes
                                from public.contacts d
                                where d.id = any(p_duplicate_ids)
                              ) s,
                              lateral jsonb_each(s.custom_attributes)
                              where not p.custom_attributes ? key
                            )
         || coalesce(p.custom_attributes, '{}'::jsonb),
         name = coalesce(p.name, (select name from public.contacts where id = any(p_duplicate_ids) and name is not null limit 1)),
         phone_number = coalesce(p.phone_number, (select phone_number from public.contacts where id = any(p_duplicate_ids) and phone_number is not null limit 1)),
         email = coalesce(p.email, (select email from public.contacts where id = any(p_duplicate_ids) and email is not null limit 1)),
         avatar_url = coalesce(p.avatar_url, (select avatar_url from public.contacts where id = any(p_duplicate_ids) and avatar_url is not null limit 1))
   where p.id = p_primary_id;

  -- Finally drop the duplicates.
  delete from public.contacts where id = any(p_duplicate_ids);
  get diagnostics v_dup_count = row_count;`;
    const mergeFixed = `  -- Union of custom_attributes (primary wins on keys that already exist).
  -- Captured into variables BEFORE deleting the duplicates: writing these
  -- onto the primary while a duplicate still holds the same email/identifier
  -- would trip the unique constraints on public.contacts.
  select
    coalesce(p.custom_attributes, '{}'::jsonb)
                         || (
                              select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
                              from (
                                select d.custom_attributes
                                from public.contacts d
                                where d.id = any(p_duplicate_ids)
                              ) s,
                              lateral jsonb_each(s.custom_attributes)
                              where not p.custom_attributes ? key
                            )
         || coalesce(p.custom_attributes, '{}'::jsonb),
    coalesce(p.name, (select name from public.contacts where id = any(p_duplicate_ids) and name is not null limit 1)),
    coalesce(p.phone_number, (select phone_number from public.contacts where id = any(p_duplicate_ids) and phone_number is not null limit 1)),
    coalesce(p.email, (select email from public.contacts where id = any(p_duplicate_ids) and email is not null limit 1))
    into v_merged_custom_attrs, v_merged_name, v_merged_phone, v_merged_email
    from public.contacts p where p.id = p_primary_id;

  -- Drop the duplicates first — now safe to write the merged fields onto
  -- the primary without colliding with a row we're about to delete anyway.
  delete from public.contacts where id = any(p_duplicate_ids);
  get diagnostics v_dup_count = row_count;

  update public.contacts
     set custom_attributes = v_merged_custom_attrs,
         name = v_merged_name,
         phone_number = v_merged_phone,
         email = v_merged_email
   where id = p_primary_id;`;

    let patched = sql;
    for (const [needle, fixed, label] of [
      [declareNeedle, declareFixed, 'declare block'],
      [mergeNeedle, mergeFixed, 'merge/delete ordering'],
    ]) {
      if (!patched.includes(needle)) {
        throw new Error(`KNOWN_FIXES patch target not found (merge_contacts ${label}) — migration content changed?`);
      }
      patched = patched.replace(needle, () => fixed);
    }
    return patched;
  },
  '20260521193456_9ed0bf89-ae0d-4b07-9beb-735d08b735e6.sql': (sql) => {
    // tg_message_update_contact() joins channels directly on
    // channels.inbox_id — that column doesn't exist; the FK runs the other
    // way (inboxes.channel_id -> channels.id). Every INSERT into messages
    // fires this trigger and fails with 42703 undefined_column, rolling
    // back the whole message insert. Discovered by actually inserting a
    // message against the ported schema.
    const needle = `  SELECT c.contact_id, ch.channel_type
    INTO v_contact_id, v_channel_type
  FROM public.conversations c
  LEFT JOIN public.channels ch ON ch.inbox_id = c.inbox_id
  WHERE c.id = NEW.conversation_id;`;
    if (!sql.includes(needle)) {
      throw new Error('KNOWN_FIXES patch target not found (tg_message_update_contact join) — migration content changed?');
    }
    const fixed = `  SELECT c.contact_id, ch.channel_type
    INTO v_contact_id, v_channel_type
  FROM public.conversations c
  LEFT JOIN public.inboxes i ON i.id = c.inbox_id
  LEFT JOIN public.channels ch ON ch.id = i.channel_id
  WHERE c.id = NEW.conversation_id;`;
    return sql.replace(needle, () => fixed);
  },
  // Same audit_log/entity_type bug as set_account_secret/lgpd_delete_contact
  // above, found by grepping every INSERT INTO public.audit_log missing
  // entity_type after the first occurrence — these three are the remaining
  // ones actually exercised (or reachable) by the ported backend. The
  // others found by that grep are superseded by a later CREATE OR REPLACE
  // of the same function and never run.
  '20260423191559_a917333f-f730-4c37-9315-baf967036fdc.sql': (sql) => {
    const skippedNeedle = `    INSERT INTO public.audit_log (account_id, action, resource_type, resource_id, metadata)
    VALUES (NEW.account_id, 'skipped', 'auto_reply_trigger', NEW.id::text, jsonb_build_object('reason', 'inbox_not_found', 'conversation_id', NEW.conversation_id));`;
    const skippedFixed = `    INSERT INTO public.audit_log (account_id, action, entity_type, entity_id, resource_type, resource_id, metadata)
    VALUES (NEW.account_id, 'skipped', 'auto_reply_trigger', NEW.id::text, 'auto_reply_trigger', NEW.id::text, jsonb_build_object('reason', 'inbox_not_found', 'conversation_id', NEW.conversation_id));`;
    const errorNeedle = `    INSERT INTO public.audit_log (account_id, action, resource_type, resource_id, metadata)
    VALUES (NEW.account_id, 'pg_net_error', 'auto_reply_trigger', NEW.id::text, jsonb_build_object('sqlstate', SQLSTATE, 'message', SQLERRM, 'conversation_id', NEW.conversation_id, 'inbox_id', v_inbox_id));`;
    const errorFixed = `    INSERT INTO public.audit_log (account_id, action, entity_type, entity_id, resource_type, resource_id, metadata)
    VALUES (NEW.account_id, 'pg_net_error', 'auto_reply_trigger', NEW.id::text, 'auto_reply_trigger', NEW.id::text, jsonb_build_object('sqlstate', SQLSTATE, 'message', SQLERRM, 'conversation_id', NEW.conversation_id, 'inbox_id', v_inbox_id));`;
    let patched = sql;
    for (const [needle, fixed, label] of [
      [skippedNeedle, skippedFixed, 'skipped branch'],
      [errorNeedle, errorFixed, 'pg_net_error branch'],
    ]) {
      if (!patched.includes(needle)) {
        throw new Error(`KNOWN_FIXES patch target not found (tg_trigger_auto_reply ${label}) — migration content changed?`);
      }
      patched = patched.replace(needle, () => fixed);
    }
    return patched;
  },
  '20260424233302_64e6cc48-f5cb-436d-88dc-c84eb636201d.sql': (sql) => {
    const needle = `  INSERT INTO public.audit_log (account_id, user_id, action, resource_type, resource_id, metadata)
  SELECT
    (SELECT account_id FROM public.account_users WHERE user_id = v_uid LIMIT 1),
    v_uid, 'app_settings_saved', 'app_settings', '00000000-0000-0000-0000-000000000001',
    jsonb_build_object('has_url', p_supabase_url IS NOT NULL);`;
    if (!sql.includes(needle)) {
      throw new Error('KNOWN_FIXES patch target not found (save_app_settings audit_log) — migration content changed?');
    }
    const fixed = `  INSERT INTO public.audit_log (account_id, user_id, actor_id, action, entity_type, entity_id, resource_type, resource_id, metadata)
  SELECT
    (SELECT account_id FROM public.account_users WHERE user_id = v_uid LIMIT 1),
    v_uid, v_uid, 'app_settings_saved', 'app_settings', '00000000-0000-0000-0000-000000000001', 'app_settings', '00000000-0000-0000-0000-000000000001',
    jsonb_build_object('has_url', p_supabase_url IS NOT NULL);`;
    return sql.replace(needle, () => fixed);
  },
  '20260427024825_3bd4dffe-f1c8-44b3-bbbf-496eaa21ea90.sql': (sql) => {
    const needle = `  INSERT INTO public.audit_log (account_id, user_id, action, resource_type, resource_id, metadata)
  VALUES (
    v_arr.account_id,
    v_uid,
    'arrangement.mark_paid',
    'payment_arrangement',
    p_arrangement_id::text,
    jsonb_build_object('payment_method', p_payment_method, 'note', p_note)
  );`;
    if (!sql.includes(needle)) {
      throw new Error('KNOWN_FIXES patch target not found (mark_arrangement_paid audit_log) — migration content changed?');
    }
    const fixed = `  INSERT INTO public.audit_log (account_id, user_id, actor_id, action, entity_type, entity_id, resource_type, resource_id, metadata)
  VALUES (
    v_arr.account_id,
    v_uid,
    v_uid,
    'arrangement.mark_paid',
    'payment_arrangement',
    p_arrangement_id::text,
    'payment_arrangement',
    p_arrangement_id::text,
    jsonb_build_object('payment_method', p_payment_method, 'note', p_note)
  );`;
    return sql.replace(needle, () => fixed);
  },
};

function escapeForTemplateLiteral(sql) {
  return sql.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

// Splits a SQL script into top-level statements, respecting dollar-quoted
// bodies ($$...$$ / $tag$...$tag$, used by every plpgsql function/DO block
// here), single/double-quoted strings, and -- / block comments — so a `;`
// inside a function body doesn't end the statement early.
//
// This matters because Postgres requires `ALTER TYPE ... ADD VALUE` to be
// committed before the new value can be used (error 55P04) — embedding an
// entire historical migration file as one queryRunner.query() call (i.e. one
// implicit transaction) breaks any file that adds an enum value and uses it
// later in the same file. Emitting one query() call per statement, combined
// with running `migration:run -t none` (see server/package.json), gives each
// statement its own implicit commit — matching how `psql -f file.sql` (the
// tool these migrations were actually written against) behaves by default.
function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let i = 0;
  const n = sql.length;
  let dollarTag = null;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < n) {
    const ch = sql[i];
    const two = sql.slice(i, i + 2);

    if (inLineComment) {
      current += ch;
      if (ch === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (two === '*/') {
        current += two;
        i += 2;
        inBlockComment = false;
        continue;
      }
      current += ch;
      i++;
      continue;
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      current += ch;
      i++;
      continue;
    }
    if (inSingle) {
      current += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          current += "'";
          i += 2;
          continue;
        }
        inSingle = false;
      }
      i++;
      continue;
    }
    if (inDouble) {
      current += ch;
      if (ch === '"') {
        if (sql[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        }
        inDouble = false;
      }
      i++;
      continue;
    }

    if (two === '--') {
      inLineComment = true;
      current += two;
      i += 2;
      continue;
    }
    if (two === '/*') {
      inBlockComment = true;
      current += two;
      i += 2;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      current += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      current += ch;
      i++;
      continue;
    }
    if (ch === '$') {
      const match = /^\$[a-zA-Z_0-9]*\$/.exec(sql.slice(i));
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        i += dollarTag.length;
        continue;
      }
    }
    if (ch === ';') {
      current += ch;
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = '';
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  const trimmed = current.trim();
  if (trimmed.length > 0) statements.push(trimmed);
  return statements;
}

function toPascalSlug(rawSlug) {
  const words = rawSlug
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    // Drop pure-hex/UUID-looking chunks (Lovable/Supabase auto-generated
    // filenames like f2dd41c7, 313d, 4c97 — meaningless as identifiers).
    .filter((w) => !/^[0-9a-f]{4,}$/i.test(w) || /[g-zG-Z]/.test(w));
  const pascal = words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('');
  return pascal || 'Migration';
}

function writeMigration(timestamp, className, sql, sourceLabel) {
  const stripped = [];
  const cleanedSql = sql.replace(STRIP_EXTENSION_RE, (line) => {
    stripped.push(line.trim());
    return `-- [stripped by generate-typeorm-migrations.mjs, see scripts/db/00-compat-shims.sql]: ${line.trim()}`;
  });

  const fullClassName = `${className}${timestamp}`;
  const header = stripped.length
    ? `// Ported from ${sourceLabel}. Lines requiring Supabase-platform-only extensions were\n// commented out and replaced by scripts/db/00-compat-shims.sql equivalents:\n${stripped.map((l) => `//   ${l}`).join('\n')}\n`
    : `// Ported from ${sourceLabel}.\n`;

  const statements = splitSqlStatements(cleanedSql);
  const queryCalls = statements
    .map((stmt) => `    await queryRunner.query(\`\n${escapeForTemplateLiteral(stmt)}\n\`);`)
    .join('\n');

  const content = `import { MigrationInterface, QueryRunner } from 'typeorm';

${header}export class ${fullClassName} implements MigrationInterface {
  name = '${fullClassName}';

  public async up(queryRunner: QueryRunner): Promise<void> {
${queryCalls}
  }

  public down(): Promise<void> {
    throw new Error(
      '${fullClassName} has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
`;

  writeFileSync(join(OUT_DIR, `${timestamp}-${className}.ts`), content);
}

// 1. Compat shims — must run before every ported migration.
const compatSql = readFileSync(COMPAT_SHIMS_FILE, 'utf8');
writeMigration('20260416172400', 'CompatShims', compatSql, 'scripts/db/00-compat-shims.sql');

// 2. The 142 ported Supabase migrations, in their original order.
const files = readdirSync(SUPABASE_MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const seen = new Set(['20260416172400']);
for (const file of files) {
  const match = file.match(/^(\d{14})_(.+)\.sql$/);
  if (!match) {
    throw new Error(`Unexpected migration filename shape: ${file}`);
  }
  let [, timestamp, rawSlug] = match;
  const className = toPascalSlug(rawSlug);
  while (seen.has(timestamp)) {
    timestamp = String(BigInt(timestamp) + 1n);
  }
  seen.add(timestamp);

  let sql = readFileSync(join(SUPABASE_MIGRATIONS_DIR, file), 'utf8');
  if (KNOWN_FIXES[file]) {
    sql = KNOWN_FIXES[file](sql);
  }
  writeMigration(timestamp, className, sql, `supabase/migrations/${file}`);
}

console.log(`Generated ${files.length + 1} TypeORM migrations in ${OUT_DIR}`);

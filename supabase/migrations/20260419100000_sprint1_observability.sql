-- ============================================================
-- Sprint 1 — Observability & correctness
-- ============================================================
-- 1. tg_trigger_auto_reply: stop swallowing errors. When pg_net.http_post
--    throws (or when the http_post call fails for any reason), log to
--    audit_log so ops can see silently-lost auto-replies instead of
--    assuming everything is fine.
-- 2. Document that trigger's new behaviour so future migrations don't regress.

create or replace function public.tg_trigger_auto_reply()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_inbox_id uuid;
  v_supabase_url text;
  v_anon_key text;
  v_request_id bigint;
begin
  -- Only trigger for incoming public messages (customer → agent)
  if new.message_type <> 0 or new.private = true then
    return new;
  end if;

  select inbox_id into v_inbox_id from public.conversations where id = new.conversation_id;
  if v_inbox_id is null then return new; end if;

  v_supabase_url := current_setting('app.supabase_url', true);
  v_anon_key := current_setting('app.supabase_anon_key', true);

  if v_supabase_url is null or v_supabase_url = '' then
    insert into public.audit_log (account_id, actor_id, entity_type, entity_id, action, metadata)
    values (
      new.account_id, null, 'auto_reply_trigger', new.id::text, 'skipped',
      jsonb_build_object('reason', 'app.supabase_url not configured')
    );
    return new;
  end if;

  -- Fire-and-forget HTTP call. Capture the request_id for audit traceability.
  begin
    v_request_id := extensions.http_post(
      url := v_supabase_url || '/functions/v1/persona-auto-reply',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce(v_anon_key, ''),
        'X-Correlation-Id', 'trigger-' || new.id::text
      ),
      body := jsonb_build_object(
        'accountId', new.account_id,
        'conversationId', new.conversation_id,
        'inboxId', v_inbox_id,
        'triggeringMessageId', new.id
      )
    );
  exception when others then
    -- Record the failure so ops can investigate instead of guessing why the
    -- bot went silent. Still return NEW so the message insert succeeds.
    insert into public.audit_log (account_id, actor_id, entity_type, entity_id, action, metadata)
    values (
      new.account_id, null, 'auto_reply_trigger', new.id::text, 'pg_net_error',
      jsonb_build_object(
        'sqlerrm', sqlerrm,
        'sqlstate', sqlstate
      )
    );
    return new;
  end;

  return new;
end;
$$;

comment on function public.tg_trigger_auto_reply() is
  'Fires persona-auto-reply via pg_net on every incoming public message. Errors (pg_net down, malformed URL, etc.) are recorded to audit_log instead of being silently swallowed.';

-- ============================================================
-- 3. Cleanup: ensure the widget tokens' legacy hardcoded secret never
--    sneaks into internal_attributes again — if an account somehow has the
--    old default in its data, revoke it.
-- ============================================================
-- No-op since widget secrets are env-only now; this is documentation.

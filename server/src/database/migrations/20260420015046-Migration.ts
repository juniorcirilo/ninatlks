import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260420015046_dc97e519-d369-4969-bb8c-23e57f3871ec.sql.
export class Migration20260420015046 implements MigrationInterface {
  name = 'Migration20260420015046';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- Sprint 1: Observability — auto-reply trigger não pode mais falhar silenciosamente.
-- Refaz tg_trigger_auto_reply para gravar QUALQUER falha do pg_net (e o caso "skipped"
-- por config faltando) em audit_log com resource_type='auto_reply_trigger'.

CREATE OR REPLACE FUNCTION public.tg_trigger_auto_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_inbox_id uuid;
  v_supabase_url text;
  v_anon_key text;
  v_request_id bigint;
BEGIN
  -- Only trigger for incoming public messages (customer → agent)
  IF NEW.message_type <> 0 OR NEW.private = true THEN
    RETURN NEW;
  END IF;

  SELECT inbox_id INTO v_inbox_id FROM public.conversations WHERE id = NEW.conversation_id;
  IF v_inbox_id IS NULL THEN
    INSERT INTO public.audit_log (account_id, action, resource_type, resource_id, metadata)
    VALUES (
      NEW.account_id,
      'skipped',
      'auto_reply_trigger',
      NEW.id::text,
      jsonb_build_object('reason', 'inbox_not_found', 'conversation_id', NEW.conversation_id)
    );
    RETURN NEW;
  END IF;

  v_supabase_url := current_setting('app.supabase_url', true);
  v_anon_key := current_setting('app.supabase_anon_key', true);

  IF v_supabase_url IS NULL OR v_supabase_url = '' OR v_anon_key IS NULL OR v_anon_key = '' THEN
    INSERT INTO public.audit_log (account_id, action, resource_type, resource_id, metadata)
    VALUES (
      NEW.account_id,
      'skipped',
      'auto_reply_trigger',
      NEW.id::text,
      jsonb_build_object(
        'reason', 'guc_not_configured',
        'has_url', v_supabase_url IS NOT NULL AND v_supabase_url <> '',
        'has_key', v_anon_key IS NOT NULL AND v_anon_key <> ''
      )
    );
    RETURN NEW;
  END IF;

  BEGIN
    SELECT extensions.http_post(
      url := v_supabase_url || '/functions/v1/persona-auto-reply',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_anon_key
      ),
      body := jsonb_build_object(
        'accountId', NEW.account_id,
        'conversationId', NEW.conversation_id,
        'inboxId', v_inbox_id,
        'triggeringMessageId', NEW.id
      )
    ) INTO v_request_id;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.audit_log (account_id, action, resource_type, resource_id, metadata)
    VALUES (
      NEW.account_id,
      'pg_net_error',
      'auto_reply_trigger',
      NEW.id::text,
      jsonb_build_object(
        'sqlstate', SQLSTATE,
        'message', SQLERRM,
        'conversation_id', NEW.conversation_id,
        'inbox_id', v_inbox_id
      )
    );
  END;

  RETURN NEW;
END;
$function$;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260420015046 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}

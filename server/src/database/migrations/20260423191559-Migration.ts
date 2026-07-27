import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260423191559_a917333f-f730-4c37-9315-baf967036fdc.sql.
export class Migration20260423191559 implements MigrationInterface {
  name = 'Migration20260423191559';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
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
  IF NEW.message_type <> 0 OR NEW.private = true THEN
    RETURN NEW;
  END IF;

  SELECT inbox_id INTO v_inbox_id FROM public.conversations WHERE id = NEW.conversation_id;
  IF v_inbox_id IS NULL THEN
    INSERT INTO public.audit_log (account_id, action, entity_type, entity_id, resource_type, resource_id, metadata)
    VALUES (NEW.account_id, 'skipped', 'auto_reply_trigger', NEW.id::text, 'auto_reply_trigger', NEW.id::text, jsonb_build_object('reason', 'inbox_not_found', 'conversation_id', NEW.conversation_id));
    RETURN NEW;
  END IF;

  v_supabase_url := COALESCE(NULLIF(current_setting('app.supabase_url', true), ''), 'https://rjcgdesoiujrvtsjrgdy.supabase.co');
  v_anon_key := COALESCE(NULLIF(current_setting('app.supabase_anon_key', true), ''), 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqY2dkZXNvaXVqcnZ0c2pyZ2R5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNTE3OTYsImV4cCI6MjA5MTkyNzc5Nn0.4drXSClorhl5BIwrggMtZtak7B1ZeOnDXtC11b3hO7Y');

  BEGIN
    SELECT extensions.http_post(
      url := v_supabase_url || '/functions/v1/persona-auto-reply',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_anon_key),
      body := jsonb_build_object('accountId', NEW.account_id, 'conversationId', NEW.conversation_id, 'inboxId', v_inbox_id, 'triggeringMessageId', NEW.id)
    ) INTO v_request_id;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.audit_log (account_id, action, entity_type, entity_id, resource_type, resource_id, metadata)
    VALUES (NEW.account_id, 'pg_net_error', 'auto_reply_trigger', NEW.id::text, 'auto_reply_trigger', NEW.id::text, jsonb_build_object('sqlstate', SQLSTATE, 'message', SQLERRM, 'conversation_id', NEW.conversation_id, 'inbox_id', v_inbox_id));
  END;

  RETURN NEW;
END;
$function$;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260423191559 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}

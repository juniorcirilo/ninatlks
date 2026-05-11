
-- Allow synthetic personas (no source user)
ALTER TABLE public.agent_personas ALTER COLUMN source_user_id DROP NOT NULL;

-- Enable pg_net for async edge function invocation from triggers
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Trigger function: on incoming customer message, call persona-auto-reply edge function
CREATE OR REPLACE FUNCTION public.tg_trigger_auto_reply()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_inbox_id uuid;
  v_supabase_url text;
  v_anon_key text;
BEGIN
  -- Only trigger for incoming public messages (customer → agent)
  IF NEW.message_type <> 0 OR NEW.private = true THEN
    RETURN NEW;
  END IF;

  -- Get inbox_id from conversation
  SELECT inbox_id INTO v_inbox_id FROM public.conversations WHERE id = NEW.conversation_id;
  IF v_inbox_id IS NULL THEN RETURN NEW; END IF;

  -- Read project URL from settings (set via app config)
  v_supabase_url := current_setting('app.supabase_url', true);
  v_anon_key := current_setting('app.supabase_anon_key', true);

  IF v_supabase_url IS NULL OR v_supabase_url = '' THEN
    RETURN NEW;
  END IF;

  -- Fire-and-forget HTTP call to edge function
  PERFORM extensions.http_post(
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
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block message insert on auto-reply failure
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_auto_reply ON public.messages;
CREATE TRIGGER trg_messages_auto_reply
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.tg_trigger_auto_reply();

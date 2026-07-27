import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260426235233_b8af2d8b-272d-491d-bb13-9e5c0c2fbaf2.sql.
export class Migration20260426235233 implements MigrationInterface {
  name = 'Migration20260426235233';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- Add quota columns to voice_campaigns. NULL = unlimited.
ALTER TABLE public.voice_campaigns
  ADD COLUMN IF NOT EXISTS max_calls_per_day      integer,
  ADD COLUMN IF NOT EXISTS max_calls_per_week     integer,
  ADD COLUMN IF NOT EXISTS max_calls_per_month    integer,
  ADD COLUMN IF NOT EXISTS max_messages_per_day   integer,
  ADD COLUMN IF NOT EXISTS max_messages_per_week  integer,
  ADD COLUMN IF NOT EXISTS max_messages_per_month integer;
`);
    await queryRunner.query(`
-- Helper: counts how many calls/messages a campaign already used in
-- day/week/month windows, and whether a new dispatch is allowed.
-- Returns:
--   allowed boolean,
--   reason text,                           -- 'ok' | 'calls_day_cap' | 'calls_week_cap' | ...
--   calls_day, calls_week, calls_month,
--   messages_day, messages_week, messages_month,
--   cap_calls_day, cap_calls_week, cap_calls_month,
--   cap_messages_day, cap_messages_week, cap_messages_month
CREATE OR REPLACE FUNCTION public.voice_campaign_quota_check(
  p_campaign_id uuid,
  p_kind text DEFAULT 'call'  -- 'call' or 'message'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_camp record;
  v_now timestamptz := now();
  v_day_start timestamptz := date_trunc('day', v_now);
  v_week_start timestamptz := date_trunc('week', v_now);
  v_month_start timestamptz := date_trunc('month', v_now);
  v_calls_day int := 0;
  v_calls_week int := 0;
  v_calls_month int := 0;
  v_msgs_day int := 0;
  v_msgs_week int := 0;
  v_msgs_month int := 0;
  v_allowed boolean := true;
  v_reason text := 'ok';
BEGIN
  SELECT id, account_id,
         max_calls_per_day, max_calls_per_week, max_calls_per_month,
         max_messages_per_day, max_messages_per_week, max_messages_per_month
    INTO v_camp
    FROM public.voice_campaigns
   WHERE id = p_campaign_id;

  IF v_camp.id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'not_found');
  END IF;

  -- Calls: contagem por dispatched_at em voice_campaign_contacts.
  IF p_kind = 'call' THEN
    SELECT
      count(*) FILTER (WHERE dispatched_at >= v_day_start),
      count(*) FILTER (WHERE dispatched_at >= v_week_start),
      count(*) FILTER (WHERE dispatched_at >= v_month_start)
      INTO v_calls_day, v_calls_week, v_calls_month
      FROM public.voice_campaign_contacts
     WHERE campaign_id = p_campaign_id
       AND dispatched_at IS NOT NULL;

    IF v_camp.max_calls_per_day IS NOT NULL AND v_calls_day >= v_camp.max_calls_per_day THEN
      v_allowed := false; v_reason := 'calls_day_cap';
    ELSIF v_camp.max_calls_per_week IS NOT NULL AND v_calls_week >= v_camp.max_calls_per_week THEN
      v_allowed := false; v_reason := 'calls_week_cap';
    ELSIF v_camp.max_calls_per_month IS NOT NULL AND v_calls_month >= v_camp.max_calls_per_month THEN
      v_allowed := false; v_reason := 'calls_month_cap';
    END IF;
  END IF;

  -- Messages: linked via messages.additional_attributes->>'campaign_id'
  IF p_kind = 'message' THEN
    SELECT
      count(*) FILTER (WHERE created_at >= v_day_start),
      count(*) FILTER (WHERE created_at >= v_week_start),
      count(*) FILTER (WHERE created_at >= v_month_start)
      INTO v_msgs_day, v_msgs_week, v_msgs_month
      FROM public.messages
     WHERE account_id = v_camp.account_id
       AND message_type = 1  -- outgoing
       AND additional_attributes->>'campaign_id' = p_campaign_id::text;

    IF v_camp.max_messages_per_day IS NOT NULL AND v_msgs_day >= v_camp.max_messages_per_day THEN
      v_allowed := false; v_reason := 'messages_day_cap';
    ELSIF v_camp.max_messages_per_week IS NOT NULL AND v_msgs_week >= v_camp.max_messages_per_week THEN
      v_allowed := false; v_reason := 'messages_week_cap';
    ELSIF v_camp.max_messages_per_month IS NOT NULL AND v_msgs_month >= v_camp.max_messages_per_month THEN
      v_allowed := false; v_reason := 'messages_month_cap';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'reason', v_reason,
    'calls_day', v_calls_day,
    'calls_week', v_calls_week,
    'calls_month', v_calls_month,
    'messages_day', v_msgs_day,
    'messages_week', v_msgs_week,
    'messages_month', v_msgs_month,
    'cap_calls_day', v_camp.max_calls_per_day,
    'cap_calls_week', v_camp.max_calls_per_week,
    'cap_calls_month', v_camp.max_calls_per_month,
    'cap_messages_day', v_camp.max_messages_per_day,
    'cap_messages_week', v_camp.max_messages_per_week,
    'cap_messages_month', v_camp.max_messages_per_month
  );
END;
$$;
`);
    await queryRunner.query(`
GRANT EXECUTE ON FUNCTION public.voice_campaign_quota_check(uuid, text) TO authenticated, service_role;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260426235233 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}

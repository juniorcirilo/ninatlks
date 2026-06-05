
CREATE OR REPLACE FUNCTION public.is_phone_allowed_to_call(
  p_account_id uuid,
  p_phone_number text,
  p_timezone text DEFAULT 'America/Sao_Paulo'::text,
  p_allowed_hours_local jsonb DEFAULT NULL::jsonb,
  p_max_attempts_per_day integer DEFAULT 2,
  p_min_minutes_between_attempts integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_now_local timestamptz := (now() at time zone p_timezone);
  v_dow text := lower(to_char(v_now_local, 'dy'));
  v_hour int := extract(hour from v_now_local);
  v_hours_range jsonb; v_start int; v_end int;
  v_attempts_today int; v_last_attempt_at timestamptz; v_dnc_hit int;
begin
  select count(*) into v_dnc_hit from public.dnc_list
   where account_id = p_account_id and phone_number = p_phone_number;
  if v_dnc_hit > 0 then return jsonb_build_object('allowed', false, 'reason', 'dnc'); end if;

  if p_allowed_hours_local is not null then
    v_hours_range := p_allowed_hours_local -> v_dow;
    if v_hours_range is null or jsonb_typeof(v_hours_range) = 'null' then
      return jsonb_build_object('allowed', false, 'reason', 'outside_allowed_day');
    end if;
    v_start := (v_hours_range -> 0)::int; v_end := (v_hours_range -> 1)::int;
    if v_hour < v_start or v_hour >= v_end then
      return jsonb_build_object('allowed', false, 'reason', 'outside_allowed_hours',
        'allowed_range', v_hours_range, 'now_hour_local', v_hour);
    end if;
  end if;

  -- Count ONLY real call attempts (not blocked_* re-queue logs), otherwise
  -- the dispatcher's own retries would inflate the count and lock the contact.
  select count(*), max(attempt_at) into v_attempts_today, v_last_attempt_at
    from public.call_attempts_log
   where account_id = p_account_id
     and phone_number = p_phone_number
     and attempt_at >= date_trunc('day', now())
     and outcome NOT LIKE 'blocked_%';

  if v_attempts_today >= p_max_attempts_per_day then
    return jsonb_build_object('allowed', false, 'reason', 'max_attempts_today',
      'attempts', v_attempts_today, 'cap', p_max_attempts_per_day);
  end if;

  if v_last_attempt_at is not null
     and (extract(epoch from (now() - v_last_attempt_at)) / 60) < p_min_minutes_between_attempts then
    return jsonb_build_object('allowed', false, 'reason', 'too_soon',
      'last_attempt_at', v_last_attempt_at, 'min_gap_minutes', p_min_minutes_between_attempts);
  end if;
  return jsonb_build_object('allowed', true);
end;
$function$;

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `is_phone_allowed_to_call` só pulava a checagem de janela com
 * `p_allowed_hours_local is not null`. Mas os dois chamadores em TS passam
 * `JSON.stringify(config)`, e quando não há config isso produz a string
 * "null" — que no Postgres é jsonb 'null', um valor JSON válido para o qual
 * `IS NOT NULL` é verdadeiro. A função então entrava na checagem, fazia
 * `'null'::jsonb -> 'mon'` (SQL NULL) e devolvia 'outside_allowed_day' em
 * qualquer dia e hora.
 *
 * Efeito em produção: toda campanha com a janela não configurada ficava com os
 * contatos em 'queued' pra sempre, o dispatcher reagendando dispatch_after a
 * cada tick, sem nada no log além de `blocked_outside_allowed_day` em
 * call_attempts_log. O caminho de ligação avulsa escapava só porque tem
 * DEFAULT_DIALING com janela real.
 *
 * Aqui a função passa a tratar jsonb 'null' igual a SQL NULL (sem restrição de
 * janela). O default sensato de horário é responsabilidade do chamador — ver
 * DEFAULT_ALLOWED_HOURS_LOCAL, que o dispatcher agora aplica.
 */
export class FixAllowedHoursJsonNull20260727160000
  implements MigrationInterface
{
  name = 'FixAllowedHoursJsonNull20260727160000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
create or replace function public.is_phone_allowed_to_call(
  p_account_id uuid,
  p_phone_number text,
  p_timezone text default 'America/Sao_Paulo',
  p_allowed_hours_local jsonb default null,
  p_max_attempts_per_day integer default 2,
  p_min_minutes_between_attempts integer default 120
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
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

  -- jsonb_typeof(...) = 'null' cobre o JSON null vindo de JSON.stringify(null);
  -- ambos significam "nenhuma janela configurada", não "nenhum dia liberado".
  if p_allowed_hours_local is not null
     and jsonb_typeof(p_allowed_hours_local) <> 'null' then
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
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
create or replace function public.is_phone_allowed_to_call(
  p_account_id uuid,
  p_phone_number text,
  p_timezone text default 'America/Sao_Paulo',
  p_allowed_hours_local jsonb default null,
  p_max_attempts_per_day integer default 2,
  p_min_minutes_between_attempts integer default 120
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
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
`);
  }
}

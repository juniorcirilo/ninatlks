import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * cadence-tick.processor.ts hoje chama `cadence_advance(execution_id, true,
 * NULL)` logo depois de *disparar* a ligação (EL aceitou o outbound-call),
 * não depois dela terminar — o resultado real (atendida, caixa postal, não
 * atendeu) nunca é lido de volta, então a cadência sempre avança num timer
 * fixo. Esta migration liga as duas pontas:
 *
 *  - `waiting_call_id` marca em qual voice_calls a execução está esperando
 *    desfecho, e tira a execução da fila do `cadence_due` (status='running'
 *    não é 'pending') até `call-finalize.service.ts` decidir o desfecho.
 *  - `cadence_mark_waiting_call` é o wrapper SECURITY DEFINER pro UPDATE, no
 *    mesmo padrão de migrations/20260720250000-OutboundDialCronBypass.ts:
 *    cadence-tick roda sem sessão (job de fila), e sob RLS real um UPDATE cru
 *    aqui silenciaria como zero linhas em vez de erro.
 *  - `cadence_stale_running_scan` é a rede de segurança: se o webhook da EL
 *    nunca chegar e o retry de voice-call-finalize-pending (a cada 2min,
 *    calls presas há >90s) também não pegar por algum motivo, a execução não
 *    pode ficar presa em 'running' pra sempre — o próprio cadence-tick (já
 *    roda a cada 5min) varre e força o avanço com sucesso=false depois de
 *    20min, uma folga generosa sobre o pior caso do finalize-pending.
 *  - `followup_list_cadences` ganha `waiting_count`/`failed_count`: sem eles,
 *    uma execução que sai de 'pending' pra 'running' simplesmente some da
 *    tela (só existia pending_count/completed_count) — exatamente a queixa
 *    de "não tem nada que acompanhe" que motivou esta mudança.
 */
export class CadenceCallOutcomeLink20260731110000
  implements MigrationInterface
{
  name = 'CadenceCallOutcomeLink20260731110000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
alter table public.follow_up_executions
  add column if not exists waiting_call_id uuid references public.voice_calls(id) on delete set null;
`);
    await queryRunner.query(`
create index if not exists idx_follow_up_executions_waiting_call
  on public.follow_up_executions(waiting_call_id)
  where waiting_call_id is not null;
`);
    await queryRunner.query(`
create or replace function public.cadence_mark_waiting_call(
  p_execution_id uuid,
  p_voice_call_id uuid
) returns void
language sql
security definer
set search_path = public
as $$
  update public.follow_up_executions
     set status = 'running',
         waiting_call_id = p_voice_call_id,
         updated_at = now()
   where id = p_execution_id;
$$;
`);
    await queryRunner.query(`
grant execute on function public.cadence_mark_waiting_call(uuid, uuid) to authenticated, service_role;
`);
    await queryRunner.query(`
create or replace function public.cadence_stale_running_scan(p_stale_minutes integer default 20)
returns table (execution_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select id from public.follow_up_executions
   where status = 'running'
     and updated_at < now() - (p_stale_minutes || ' minutes')::interval;
$$;
`);
    await queryRunner.query(`
grant execute on function public.cadence_stale_running_scan(integer) to authenticated, service_role;
`);
    await queryRunner.query(`
create or replace function public.followup_list_cadences(p_account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_account_member(auth.uid(), p_account_id) then
    raise exception 'forbidden';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'description', c.description,
      'trigger_event', c.trigger_event,
      'trigger_stage_id', c.trigger_stage_id,
      'enabled', c.enabled,
      'steps', c.steps,
      'pending_count', (
        select count(*) from public.follow_up_executions e
        where e.cadence_id = c.id and e.status = 'pending'
      ),
      'waiting_count', (
        select count(*) from public.follow_up_executions e
        where e.cadence_id = c.id and e.status = 'running'
      ),
      'completed_count', (
        select count(*) from public.follow_up_executions e
        where e.cadence_id = c.id and e.status = 'completed'
      ),
      'failed_count', (
        select count(*) from public.follow_up_executions e
        where e.cadence_id = c.id and e.status = 'failed'
      )
    )
    order by c.created_at desc
  ), '[]'::jsonb)
  into v_result
  from public.follow_up_cadences c
  where c.account_id = p_account_id;

  return v_result;
end$$;
`);
    await queryRunner.query(`
grant execute on function public.followup_list_cadences(uuid) to authenticated, service_role;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
create or replace function public.followup_list_cadences(p_account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_account_member(auth.uid(), p_account_id) then
    raise exception 'forbidden';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'description', c.description,
      'trigger_event', c.trigger_event,
      'trigger_stage_id', c.trigger_stage_id,
      'enabled', c.enabled,
      'steps', c.steps,
      'pending_count', (
        select count(*) from public.follow_up_executions e
        where e.cadence_id = c.id and e.status = 'pending'
      ),
      'completed_count', (
        select count(*) from public.follow_up_executions e
        where e.cadence_id = c.id and e.status = 'completed'
      )
    )
    order by c.created_at desc
  ), '[]'::jsonb)
  into v_result
  from public.follow_up_cadences c
  where c.account_id = p_account_id;

  return v_result;
end$$;
`);
    await queryRunner.query(
      `drop function if exists public.cadence_stale_running_scan(integer);`,
    );
    await queryRunner.query(
      `drop function if exists public.cadence_mark_waiting_call(uuid, uuid);`,
    );
    await queryRunner.query(
      `drop index if exists public.idx_follow_up_executions_waiting_call;`,
    );
    await queryRunner.query(
      `alter table public.follow_up_executions drop column if exists waiting_call_id;`,
    );
  }
}

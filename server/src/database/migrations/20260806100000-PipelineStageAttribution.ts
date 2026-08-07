import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hoje três gravadores independentes (CallClassificationService,
 * CallSentimentService, AgentToolsService) e o move manual do Kanban podem
 * mudar `contacts.stage_id`, mas nada registra QUEM moveu — o frontend só
 * tinha um heurístico frágil (`auto_moved_at` nos últimos 5 minutos) pra
 * mostrar o badge "IA", que some depois disso mesmo que o card nunca tenha
 * sido tocado por um humano. `stage_source` dá atribuição persistente e
 * correta; `stage_change_reason` dá lugar pro motivo quando o operador move
 * um lead manualmente para um estágio de perda.
 */
export class PipelineStageAttribution20260806100000 implements MigrationInterface {
  name = 'PipelineStageAttribution20260806100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
alter table public.contacts
  add column if not exists stage_source text
    check (stage_source in ('classification','sentiment','agent_tool','manual')),
  add column if not exists stage_change_reason text;
`);

    // --- contact_update_classification: passa a marcar 'classification' e
    // carimbar auto_moved_at só quando de fato atribui um estágio (campanhas
    // não-SDR chamam com _stage_id = NULL e não devem acender o badge de IA).
    await queryRunner.query(`
create or replace function public.contact_update_classification(
  _id uuid, _score int, _briefing jsonb, _source text, _stage_id uuid, _name text
)
returns void
language sql security definer set search_path = public as $$
  update public.contacts set
    score = _score, briefing = _briefing, source = _source,
    stage_id = coalesce(_stage_id, stage_id),
    stage_source = case when _stage_id is not null then 'classification' else stage_source end,
    auto_moved_at = case when _stage_id is not null then now() else auto_moved_at end,
    name = coalesce(_name, name), updated_at = now()
  where id = _id;
$$;
`);

    // --- contact_apply_sentiment: marca 'sentiment' só no ramo que move estágio.
    await queryRunner.query(`
create or replace function public.contact_apply_sentiment(
  _id uuid, _sentiment text, _sentiment_score numeric, _new_stage_id uuid default null
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if _new_stage_id is not null then
    update public.contacts set
      last_sentiment = _sentiment, last_sentiment_score = _sentiment_score,
      stage_id = _new_stage_id, stage_changed_at = now(), auto_moved_at = now(),
      stage_source = 'sentiment', updated_at = now()
    where id = _id;
  else
    update public.contacts set
      last_sentiment = _sentiment, last_sentiment_score = _sentiment_score, updated_at = now()
    where id = _id;
  end if;
end;
$$;
`);

    // --- lead_move_to_stage ganha p_reason (default null) — assinatura muda
    // de (uuid,uuid) para (uuid,uuid,text), então o antigo overload sai antes
    // de recriar, pra não deixar duas funções fazendo a mesma coisa.
    await queryRunner.query(`
drop function if exists public.lead_move_to_stage(uuid, uuid);
`);
    await queryRunner.query(`
create or replace function public.lead_move_to_stage(p_contact_id uuid, p_stage_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_stage_account_id uuid;
begin
  select account_id into v_account_id from public.contacts where id = p_contact_id;
  if v_account_id is null then raise exception 'contact not found'; end if;

  if not public.is_account_member(auth.uid(), v_account_id) then
    raise exception 'forbidden';
  end if;

  select p.account_id into v_stage_account_id
    from public.lead_stages s
    join public.lead_pipelines p on p.id = s.pipeline_id
    where s.id = p_stage_id;
  if v_stage_account_id is null or v_stage_account_id <> v_account_id then
    raise exception 'stage does not belong to this account';
  end if;

  update public.contacts set
    stage_id = p_stage_id,
    stage_source = 'manual',
    stage_change_reason = p_reason,
    auto_moved_at = null
  where id = p_contact_id;
end$$;
`);
    await queryRunner.query(`
grant execute on function public.lead_move_to_stage(uuid, uuid, text) to authenticated, service_role;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
drop function if exists public.lead_move_to_stage(uuid, uuid, text);
`);
    await queryRunner.query(`
create or replace function public.lead_move_to_stage(p_contact_id uuid, p_stage_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_stage_account_id uuid;
begin
  select account_id into v_account_id from public.contacts where id = p_contact_id;
  if v_account_id is null then raise exception 'contact not found'; end if;

  if not public.is_account_member(auth.uid(), v_account_id) then
    raise exception 'forbidden';
  end if;

  select p.account_id into v_stage_account_id
    from public.lead_stages s
    join public.lead_pipelines p on p.id = s.pipeline_id
    where s.id = p_stage_id;
  if v_stage_account_id is null or v_stage_account_id <> v_account_id then
    raise exception 'stage does not belong to this account';
  end if;

  update public.contacts set stage_id = p_stage_id where id = p_contact_id;
end$$;
`);
    await queryRunner.query(`
grant execute on function public.lead_move_to_stage(uuid, uuid) to authenticated, service_role;
`);

    await queryRunner.query(`
create or replace function public.contact_apply_sentiment(
  _id uuid, _sentiment text, _sentiment_score numeric, _new_stage_id uuid default null
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if _new_stage_id is not null then
    update public.contacts set
      last_sentiment = _sentiment, last_sentiment_score = _sentiment_score,
      stage_id = _new_stage_id, stage_changed_at = now(), auto_moved_at = now(), updated_at = now()
    where id = _id;
  else
    update public.contacts set
      last_sentiment = _sentiment, last_sentiment_score = _sentiment_score, updated_at = now()
    where id = _id;
  end if;
end;
$$;
`);

    await queryRunner.query(`
create or replace function public.contact_update_classification(
  _id uuid, _score int, _briefing jsonb, _source text, _stage_id uuid, _name text
)
returns void
language sql security definer set search_path = public as $$
  update public.contacts set
    score = _score, briefing = _briefing, source = _source,
    stage_id = coalesce(_stage_id, stage_id), name = coalesce(_name, name), updated_at = now()
  where id = _id;
$$;
`);

    await queryRunner.query(`
alter table public.contacts
  drop column if exists stage_source,
  drop column if exists stage_change_reason;
`);
  }
}

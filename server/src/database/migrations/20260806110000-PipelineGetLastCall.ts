import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `pipeline_get` hoje devolve score/briefing/sentimento mas nunca diz QUAL
 * ligação gerou aquilo — o card do Kanban não tem outcome, direção nem link
 * pra ligação. Mesmo join por telefone que `CallsService.list`
 * (server/src/modules/calls/calls.service.ts) já usa pra amarrar
 * `voice_calls` a `contacts`, só que partindo do contato: pega a ligação
 * mais recente por `phone_number` e expõe outcome/summary/direção/hora.
 * `stage_source` (PipelineStageAttribution20260806100000) também passa a
 * vir no payload, substituindo a janela de 5min do `auto_moved_at` como
 * atribuição de "quem moveu".
 */
export class PipelineGetLastCall20260806110000 implements MigrationInterface {
  name = 'PipelineGetLastCall20260806110000';

  private readonly newDefinition = `
create or replace function public.pipeline_get(p_account_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_pipeline_id uuid;
  v_result jsonb;
begin
  if not public.is_account_member(auth.uid(), p_account_id) then
    raise exception 'forbidden';
  end if;

  select id into v_pipeline_id
    from public.lead_pipelines
    where account_id = p_account_id and is_default = true
    limit 1;

  if v_pipeline_id is null then
    v_pipeline_id := public.seed_default_pipeline(p_account_id);
  end if;

  select jsonb_build_object(
    'pipeline_id', v_pipeline_id,
    'stages', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', s.id,
            'name', s.name,
            'position', s.position,
            'color', s.color,
            'is_won', s.is_won,
            'is_lost', s.is_lost,
            'leads', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', c.id,
                  'name', c.name,
                  'phone_number', c.phone_number,
                  'email', c.email,
                  'score', c.score,
                  'source', c.source,
                  'stage_changed_at', c.stage_changed_at,
                  'last_activity_at', c.last_activity_at,
                  'briefing', c.briefing,
                  'last_sentiment', c.last_sentiment,
                  'last_sentiment_score', c.last_sentiment_score,
                  'auto_moved_at', c.auto_moved_at,
                  'stage_source', c.stage_source,
                  'stage_change_reason', c.stage_change_reason,
                  'last_call_id', lc.id,
                  'last_call_direction', lc.direction,
                  'last_call_outcome_category', lc.outcome_category,
                  'last_call_outcome_summary', coalesce(lc.outcome_summary, lc.ai_summary),
                  'last_call_started_at', lc.started_at
                )
                order by c.score desc, c.stage_changed_at desc nulls last
              )
              from public.contacts c
              left join lateral (
                select vc.id, vc.direction::text as direction, vc.outcome_category,
                       vc.outcome_summary, vc.ai_summary, vc.started_at
                  from public.voice_calls vc
                 where vc.account_id = p_account_id
                   and c.phone_number is not null
                   and (
                     (vc.direction::text = 'outbound' and vc.to_number = c.phone_number)
                     or (vc.direction::text = 'inbound' and vc.from_number = c.phone_number)
                   )
                 order by vc.started_at desc nulls last
                 limit 1
              ) lc on true
              where c.account_id = p_account_id
                and c.stage_id = s.id
                and not c.blocked
            ), '[]'::jsonb)
          )
          order by s.position
        )
        from public.lead_stages s
        where s.pipeline_id = v_pipeline_id
      ),
      '[]'::jsonb
    )
  ) into v_result;

  return v_result;
end$$;
`;

  private readonly oldDefinition = `
create or replace function public.pipeline_get(p_account_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_pipeline_id uuid;
  v_result jsonb;
begin
  if not public.is_account_member(auth.uid(), p_account_id) then
    raise exception 'forbidden';
  end if;

  select id into v_pipeline_id
    from public.lead_pipelines
    where account_id = p_account_id and is_default = true
    limit 1;

  if v_pipeline_id is null then
    v_pipeline_id := public.seed_default_pipeline(p_account_id);
  end if;

  select jsonb_build_object(
    'pipeline_id', v_pipeline_id,
    'stages', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', s.id,
            'name', s.name,
            'position', s.position,
            'color', s.color,
            'is_won', s.is_won,
            'is_lost', s.is_lost,
            'leads', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', c.id,
                  'name', c.name,
                  'phone_number', c.phone_number,
                  'email', c.email,
                  'score', c.score,
                  'source', c.source,
                  'stage_changed_at', c.stage_changed_at,
                  'last_activity_at', c.last_activity_at,
                  'briefing', c.briefing,
                  'last_sentiment', c.last_sentiment,
                  'last_sentiment_score', c.last_sentiment_score,
                  'auto_moved_at', c.auto_moved_at
                )
                order by c.score desc, c.stage_changed_at desc nulls last
              )
              from public.contacts c
              where c.account_id = p_account_id
                and c.stage_id = s.id
                and not c.blocked
            ), '[]'::jsonb)
          )
          order by s.position
        )
        from public.lead_stages s
        where s.pipeline_id = v_pipeline_id
      ),
      '[]'::jsonb
    )
  ) into v_result;

  return v_result;
end$$;
`;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(this.newDefinition);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(this.oldDefinition);
  }
}

-- 1. Campos de sentimento + auto-move no contato
alter table public.contacts
  add column if not exists last_sentiment text
    check (last_sentiment in ('positive','neutral','negative')),
  add column if not exists last_sentiment_score numeric(4,3),
  add column if not exists auto_moved_at timestamptz;

-- 2. Atualizar pipeline_get para expor os novos campos
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

-- 3. Realtime na tabela contacts (para o pipeline atualizar sozinho)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'contacts'
  ) then
    execute 'alter publication supabase_realtime add table public.contacts';
  end if;
end $$;

alter table public.contacts replica identity full;
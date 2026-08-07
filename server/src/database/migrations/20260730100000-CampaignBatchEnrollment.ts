import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Campanha viva alimentada por lista sincronizada, com trava de aprovação.
 *
 * Até aqui a campanha era um retrato: os contatos eram copiados da lista no
 * instante da criação e nunca mais mudavam. Serve para uma onda pontual, mas
 * não para uma carteira que o ERP recalcula todo dia — cobrança de títulos
 * vencidos é uma operação contínua, e criar campanha nova a cada manhã perde o
 * histórico e o funil.
 *
 * O oposto ingênuo (a carga do ERP injetar contatos direto na campanha que já
 * está discando) é pior: uma consulta mal ajustada no n8n às 6h vira ligação
 * para gente errada às 6h01, sem ninguém no meio. Daí a trava:
 *
 *  1. a carga sincroniza a lista, como já fazia;
 *  2. quem tem campanha viva apontada para aquela lista ganha um **lote
 *     pendente** com os contatos novos, gravados em voice_campaign_contacts
 *     com status 'pending_approval' — que o dispatcher não enxerga, porque ele
 *     só olha 'queued';
 *  3. uma pessoa aprova (ou rejeita) o lote na tela da campanha. Só a
 *     aprovação move para 'queued'.
 *
 * `auto_enroll_mode` fica em 'off' por padrão: campanha existente continua
 * sendo o retrato de antes, e nada muda de comportamento sem alguém pedir.
 */
export class CampaignBatchEnrollment20260730100000 implements MigrationInterface {
  name = 'CampaignBatchEnrollment20260730100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
alter table public.voice_campaigns
  add column if not exists source_list_id uuid references public.contact_lists(id) on delete set null,
  add column if not exists auto_enroll_mode text not null default 'off';
`);
    await queryRunner.query(`
alter table public.voice_campaigns
  drop constraint if exists voice_campaigns_auto_enroll_mode_check;
`);
    await queryRunner.query(`
alter table public.voice_campaigns
  add constraint voice_campaigns_auto_enroll_mode_check
  check (auto_enroll_mode in ('off', 'approval'));
`);
    await queryRunner.query(`
comment on column public.voice_campaigns.auto_enroll_mode is
  'off = campanha é um retrato da lista na criação. approval = novos membros da lista viram lote pendente, que só disca depois de aprovação humana.';
`);

    // 'pending_approval' precisa entrar no check antes de qualquer inserção.
    // O dispatcher não precisa mudar: ele filtra status = 'queued', então
    // contato pendente é invisível para ele por construção, e não por um
    // filtro que alguém possa remover sem perceber.
    await queryRunner.query(`
alter table public.voice_campaign_contacts
  drop constraint if exists voice_campaign_contacts_status_check;
`);
    await queryRunner.query(`
alter table public.voice_campaign_contacts
  add constraint voice_campaign_contacts_status_check
  check (status = any (array[
    'pending_approval','queued','placed','ringing','connected',
    'voicemail','escalated','completed','failed','canceled'
  ]));
`);

    await queryRunner.query(`
create table if not exists public.campaign_enrollment_batches (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  campaign_id uuid not null references public.voice_campaigns(id) on delete cascade,
  list_id uuid references public.contact_lists(id) on delete set null,
  contact_count integer not null default 0,
  status text not null default 'pending',
  source text,
  decided_by_id uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint campaign_enrollment_batches_status_check
    check (status in ('pending','approved','rejected'))
);
`);
    await queryRunner.query(`
create index if not exists campaign_enrollment_batches_pending_idx
  on public.campaign_enrollment_batches(campaign_id) where status = 'pending';
`);
    // Liga cada contato pendente ao lote que o trouxe, para aprovar/rejeitar
    // em bloco sem depender de janela de tempo.
    await queryRunner.query(`
alter table public.voice_campaign_contacts
  add column if not exists enrollment_batch_id uuid
  references public.campaign_enrollment_batches(id) on delete set null;
`);
    await queryRunner.query(`
create index if not exists vcc_enrollment_batch_idx
  on public.voice_campaign_contacts(enrollment_batch_id)
  where enrollment_batch_id is not null;
`);

    await queryRunner.query(`
alter table public.campaign_enrollment_batches enable row level security;
`);
    for (const stmt of [
      `drop policy if exists "ceb_select_member" on public.campaign_enrollment_batches`,
      `drop policy if exists "ceb_update_member" on public.campaign_enrollment_batches`,
      `create policy "ceb_select_member" on public.campaign_enrollment_batches
         for select to authenticated
         using (is_account_member(auth.uid(), account_id))`,
      `create policy "ceb_update_member" on public.campaign_enrollment_batches
         for update to authenticated
         using (is_account_member(auth.uid(), account_id))`,
    ]) {
      await queryRunner.query(stmt);
    }

    // ── Enfileira os membros novos da lista como lote pendente ──────────────
    //
    // SECURITY DEFINER porque o chamador é a ingestão por chave de API, sem
    // sessão — mesmo motivo de ingest_operational_list. Idempotente: contato
    // que já está na campanha (em qualquer status, inclusive já discado) não
    // volta, e rodar duas vezes seguidas não cria um segundo lote vazio.
    await queryRunner.query(`
create or replace function public.campaign_enroll_new_members(
  _campaign_id uuid,
  _source text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_campaign public.voice_campaigns%rowtype;
  v_batch_id uuid;
  v_count int;
begin
  select * into v_campaign from public.voice_campaigns where id = _campaign_id;
  if not found then
    return jsonb_build_object('enrolled', 0, 'reason', 'campaign_not_found');
  end if;
  if v_campaign.auto_enroll_mode <> 'approval' or v_campaign.source_list_id is null then
    return jsonb_build_object('enrolled', 0, 'reason', 'auto_enroll_off');
  end if;
  -- Campanha encerrada de vez não recebe lote novo. 'completed' fica de fora
  -- desta lista de propósito: numa campanha viva, "completed" só quer dizer
  -- que a carteira do dia acabou, e a aprovação de um lote a reabre.
  if v_campaign.status in ('canceled','cancelled','failed') then
    return jsonb_build_object('enrolled', 0, 'reason', 'campaign_closed');
  end if;

  -- O lote nasce com contagem 0 e é corrigido depois de inserir. A alternativa
  -- (contar antes para só então criar o lote) avaliaria a mesma consulta de
  -- membros duas vezes, e entre uma e outra a lista pode mudar — o número
  -- gravado não bateria com as linhas criadas.
  insert into public.campaign_enrollment_batches
    (account_id, campaign_id, list_id, contact_count, source)
  values (v_campaign.account_id, _campaign_id, v_campaign.source_list_id, 0, _source)
  returning id into v_batch_id;

  with inserted as (
    insert into public.voice_campaign_contacts
      (account_id, campaign_id, contact_id, to_number, phone_number, status,
       variables, enrollment_batch_id)
    select v_campaign.account_id, _campaign_id, c.id, c.phone_number,
           c.phone_number, 'pending_approval',
           coalesce(c.custom_attributes -> 'ingest_variables', '{}'::jsonb),
           v_batch_id
      from public.contact_list_members clm
      join public.contacts c on c.id = clm.contact_id
     where clm.list_id = v_campaign.source_list_id
       and c.deleted_at is null
       and c.blocked = false
       and c.phone_number is not null
       and not exists (
         select 1 from public.voice_campaign_contacts vcc
          where vcc.campaign_id = _campaign_id
            and vcc.contact_id = c.id
       )
    returning 1
  )
  select count(*) into v_count from inserted;

  -- Nada novo na lista: o lote vazio some, senão a tela encheria de lotes de
  -- zero contato a cada carga do ERP que não trouxe ninguém novo.
  if v_count = 0 then
    delete from public.campaign_enrollment_batches where id = v_batch_id;
    return jsonb_build_object('enrolled', 0, 'reason', 'no_new_members');
  end if;

  update public.campaign_enrollment_batches
     set contact_count = v_count where id = v_batch_id;

  return jsonb_build_object('enrolled', v_count, 'batchId', v_batch_id);
end;
$function$;
`);

    // ── Aprova o lote: pendente → fila ──────────────────────────────────────
    await queryRunner.query(`
create or replace function public.campaign_approve_batch(
  _batch_id uuid,
  _user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_batch public.campaign_enrollment_batches%rowtype;
  v_moved int;
begin
  select * into v_batch from public.campaign_enrollment_batches
   where id = _batch_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'batch_not_found');
  end if;
  if v_batch.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'already_decided',
      'status', v_batch.status);
  end if;

  -- dispatch_after = now() e não o valor da inserção: o lote pode ter ficado
  -- horas esperando aprovação, e o que importa para a ordem da fila é o
  -- momento em que ele foi liberado para discar.
  with moved as (
    update public.voice_campaign_contacts
       set status = 'queued', dispatch_after = now(), updated_at = now()
     where enrollment_batch_id = _batch_id
       and status = 'pending_approval'
    returning 1
  )
  select count(*) into v_moved from moved;

  update public.campaign_enrollment_batches
     set status = 'approved', decided_by_id = _user_id, decided_at = now()
   where id = _batch_id;

  -- Reabre a campanha que já tinha zerado a carteira anterior. Sem isto o
  -- lote aprovado ficaria em 'queued' numa campanha 'completed', que o
  -- dispatcher ignora — aprovado e parado, o pior dos dois mundos.
  update public.voice_campaigns
     set status = 'running',
         started_at = coalesce(started_at, now()),
         finished_at = null,
         total_contacts = (select count(*) from public.voice_campaign_contacts
                            where campaign_id = v_batch.campaign_id)
   where id = v_batch.campaign_id
     and status in ('completed','draft','scheduled');

  update public.voice_campaigns
     set total_contacts = (select count(*) from public.voice_campaign_contacts
                            where campaign_id = v_batch.campaign_id)
   where id = v_batch.campaign_id;

  return jsonb_build_object('ok', true, 'queued', v_moved);
end;
$function$;
`);

    // ── Rejeita o lote: some com os pendentes ───────────────────────────────
    await queryRunner.query(`
create or replace function public.campaign_reject_batch(
  _batch_id uuid,
  _user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_batch public.campaign_enrollment_batches%rowtype;
  v_removed int;
begin
  select * into v_batch from public.campaign_enrollment_batches
   where id = _batch_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'batch_not_found');
  end if;
  if v_batch.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'already_decided',
      'status', v_batch.status);
  end if;

  -- Apaga só as linhas de campanha ainda pendentes. O contato continua na
  -- base e na lista: rejeitar é dizer "não ligue para estes agora", não
  -- "esqueça que existem".
  --
  -- Consequência a ter em mente: como as linhas somem, a próxima carga
  -- reoferece esses contatos num lote novo. É o comportamento desejado — a
  -- rejeição valeu para a carteira daquele dia, e no dia seguinte a decisão é
  -- outra. Quem quer parar de ligar para alguém em definitivo usa a DNC, que
  -- é a trava certa para isso e vale para todas as campanhas.
  with removed as (
    delete from public.voice_campaign_contacts
     where enrollment_batch_id = _batch_id
       and status = 'pending_approval'
    returning 1
  )
  select count(*) into v_removed from removed;

  update public.campaign_enrollment_batches
     set status = 'rejected', decided_by_id = _user_id, decided_at = now()
   where id = _batch_id;

  return jsonb_build_object('ok', true, 'removed', v_removed);
end;
$function$;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `drop function if exists public.campaign_reject_batch(uuid, uuid);`,
    );
    await queryRunner.query(
      `drop function if exists public.campaign_approve_batch(uuid, uuid);`,
    );
    await queryRunner.query(
      `drop function if exists public.campaign_enroll_new_members(uuid, text);`,
    );
    await queryRunner.query(
      `alter table public.voice_campaign_contacts drop column if exists enrollment_batch_id;`,
    );
    await queryRunner.query(
      `drop table if exists public.campaign_enrollment_batches;`,
    );
    await queryRunner.query(`
alter table public.voice_campaign_contacts
  drop constraint if exists voice_campaign_contacts_status_check;
`);
    await queryRunner.query(`
alter table public.voice_campaign_contacts
  add constraint voice_campaign_contacts_status_check
  check (status = any (array[
    'queued','placed','ringing','connected','voicemail','escalated',
    'completed','failed','canceled'
  ]));
`);
    await queryRunner.query(`
alter table public.voice_campaigns
  drop constraint if exists voice_campaigns_auto_enroll_mode_check;
`);
    await queryRunner.query(`
alter table public.voice_campaigns
  drop column if exists auto_enroll_mode,
  drop column if exists source_list_id;
`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cadastro de vendedores (sales_reps) para transbordo multi-vendedor.
 *
 * Até aqui o único destino de transferência era `voice_campaigns.escalation_target_number`
 * (um número por campanha). O vendedor do lead vem do ERP como texto
 * (`companies.vendedor_nome_erp`) e nem sempre é usuário da plataforma, então
 * `profiles` não serve de fonte. `match_keys` guarda nome + aliases já normalizados
 * (sem acento, minúsculo) para o de-para na hora do disparo.
 *
 * `sales_rep_pendencias` registra leads cujo vendedor não resolveu (sem cadastro /
 * sem telefone / lead sem vendedor): a ligação segue com o número central
 * (fallback) e a pendência aparece para o time cadastrar.
 */
export class SalesReps20261001010000 implements MigrationInterface {
  name = 'SalesReps20261001010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
create table public.sales_reps (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  nome text not null,
  aliases text[] not null default '{}',
  match_keys text[] not null default '{}',
  phone_e164 text,
  email text,
  user_id uuid references public.profiles(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_reps_phone_e164_check
    check (phone_e164 is null or phone_e164 ~ '^\\+[1-9][0-9]{9,14}$')
);
`);
    await queryRunner.query(
      `create index sales_reps_account_idx on public.sales_reps(account_id) where active;`,
    );
    await queryRunner.query(
      `create index sales_reps_match_keys_idx on public.sales_reps using gin (match_keys);`,
    );
    await queryRunner.query(`
create table public.sales_rep_pendencias (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  vendedor_key text not null,
  vendedor_nome text,
  reason text not null check (reason in ('sem_vendedor','sem_cadastro','sem_telefone')),
  campaign_id uuid,
  fallback_number text,
  occurrences integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz
);
`);
    await queryRunner.query(`
create unique index sales_rep_pendencias_open_uq
  on public.sales_rep_pendencias(account_id, vendedor_key, reason)
  where resolved_at is null;
`);
    for (const t of ['sales_reps', 'sales_rep_pendencias']) {
      await queryRunner.query(`alter table public.${t} enable row level security;`);
      await queryRunner.query(`create policy "${t}_select_member" on public.${t}
         for select to authenticated
         using (is_account_member(auth.uid(), account_id))`);
      await queryRunner.query(`create policy "${t}_write_member" on public.${t}
         for all to authenticated
         using (is_account_member(auth.uid(), account_id))
         with check (is_account_member(auth.uid(), account_id))`);
    }
    await queryRunner.query(`
create trigger trg_sales_reps_updated_at before update on public.sales_reps
  for each row execute function public.tg_set_updated_at();
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`drop table if exists public.sales_rep_pendencias;`);
    await queryRunner.query(`drop table if exists public.sales_reps;`);
  }
}

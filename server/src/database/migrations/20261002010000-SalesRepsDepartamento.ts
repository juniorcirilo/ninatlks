import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roteamento departamental do transbordo: COMERCIAL (Larrisa etc.) vs FINANCEIRO (Diego).
 * Cobrança nunca pode transbordar para vendedor comercial, então o departamento passa a
 * fazer parte do cadastro (`sales_reps.departamento`) e das pendências.
 *
 * `is_default` marca o atendente padrão do departamento (um ativo por conta+departamento):
 * é o destino quando o lead não tem vendedor/telefone (COMERCIAL) e o único destino do
 * FINANCEIRO. `nome_falado` é como a IA o cita ("nossa central de atendimento comercial").
 */
export class SalesRepsDepartamento20261002010000 implements MigrationInterface {
  name = 'SalesRepsDepartamento20261002010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
alter table public.sales_reps
  add column departamento text not null default 'COMERCIAL'
    check (departamento in ('COMERCIAL','FINANCEIRO')),
  add column is_default boolean not null default false,
  add column nome_falado text;
`);
    await queryRunner.query(`
create unique index sales_reps_default_dept_uq
  on public.sales_reps(account_id, departamento)
  where is_default and active;
`);
    await queryRunner.query(`
alter table public.sales_rep_pendencias
  add column departamento text not null default 'COMERCIAL'
    check (departamento in ('COMERCIAL','FINANCEIRO'));
`);
    await queryRunner.query(`drop index if exists public.sales_rep_pendencias_open_uq;`);
    await queryRunner.query(`
create unique index sales_rep_pendencias_open_uq
  on public.sales_rep_pendencias(account_id, departamento, vendedor_key, reason)
  where resolved_at is null;
`);
    await queryRunner.query(`
alter table public.sales_rep_pendencias
  drop constraint if exists sales_rep_pendencias_reason_check;
`);
    await queryRunner.query(`
alter table public.sales_rep_pendencias
  add constraint sales_rep_pendencias_reason_check
  check (reason in ('sem_vendedor','sem_cadastro','sem_telefone','sem_atendente_padrao'));
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`delete from public.sales_rep_pendencias where reason = 'sem_atendente_padrao' or departamento <> 'COMERCIAL';`);
    await queryRunner.query(`drop index if exists public.sales_rep_pendencias_open_uq;`);
    await queryRunner.query(`
create unique index sales_rep_pendencias_open_uq
  on public.sales_rep_pendencias(account_id, vendedor_key, reason)
  where resolved_at is null;
`);
    await queryRunner.query(`alter table public.sales_rep_pendencias drop constraint if exists sales_rep_pendencias_reason_check;`);
    await queryRunner.query(`alter table public.sales_rep_pendencias add constraint sales_rep_pendencias_reason_check check (reason in ('sem_vendedor','sem_cadastro','sem_telefone'));`);
    await queryRunner.query(`alter table public.sales_rep_pendencias drop column departamento;`);
    await queryRunner.query(`drop index if exists public.sales_reps_default_dept_uq;`);
    await queryRunner.query(`alter table public.sales_reps drop column nome_falado, drop column is_default, drop column departamento;`);
  }
}

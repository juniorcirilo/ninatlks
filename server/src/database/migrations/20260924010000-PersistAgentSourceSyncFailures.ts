import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Falha de sincronização (linha que não virou contato nem título/orçamento —
 * ver `naoGravadas` em agent-sources.service.ts) hoje só existe no
 * `RunResult` devolvido pro modal da tela; fecha o modal, perde a informação.
 * Isso torna impossível auditar depois "por que só 34 dos 90 clientes desta
 * corrida viraram contato" — a resposta (telefone inválido, empresa não
 * identificada, etc.) evapora junto com o modal.
 *
 * `run()` (agent-sources.service.ts) passa a substituir as falhas da fonte a
 * cada corrida: só a última corrida importa para investigação — falha de uma
 * corrida anterior já resolvida (reenviada com sucesso) não deve continuar
 * aparecendo como pendência.
 */
export class PersistAgentSourceSyncFailures20260924010000
  implements MigrationInterface
{
  name = 'PersistAgentSourceSyncFailures20260924010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
create table public.agent_source_sync_failures (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  source_id uuid not null references public.agent_inbound_sources(id) on delete cascade,
  run_at timestamptz not null default now(),
  label text not null,
  external_id text,
  vendedor text,
  reason text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
`);
    await queryRunner.query(`
create index agent_source_sync_failures_source_idx
  on public.agent_source_sync_failures(source_id);
`);

    await queryRunner.query(`
alter table public.agent_source_sync_failures enable row level security;
`);
    for (const stmt of [
      `create policy "assf_select_member" on public.agent_source_sync_failures
         for select to authenticated
         using (is_account_member(auth.uid(), account_id))`,
      `create policy "assf_write_member" on public.agent_source_sync_failures
         for all to authenticated
         using (is_account_member(auth.uid(), account_id))
         with check (is_account_member(auth.uid(), account_id))`,
    ]) {
      await queryRunner.query(stmt);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`drop table if exists public.agent_source_sync_failures;`);
  }
}

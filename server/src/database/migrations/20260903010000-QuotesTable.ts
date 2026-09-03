import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `quotes` — orçamentos estruturados gerados pelo Bruno (Funcionário IA
 * orçamentista de vidros, ver `src/lib/agents/bruno.functions.ts`).
 *
 * Antes desta tabela, `generate_quote_pdf` tentava gravar em `quote_pdfs`
 * (só bytes do PDF, sem cliente/itens/valores) — tabela que nunca chegou a
 * ser criada por migration nenhuma, então a chamada quebrava em runtime com
 * "relation quote_pdfs does not exist". Sem persistência nenhuma, não havia
 * como listar "os orçamentos do Bruno" em lugar algum do produto.
 *
 * `persona_id` é o que amarra o orçamento ao agente que o gerou — é por ele
 * que a tela /orcamentos filtra "controlados pelo agente Bruno". Fica
 * nullable porque a persona pode ser removida depois sem apagar o histórico
 * do orçamento.
 *
 * `pdf_bytes` guarda o PDF já gerado (documento pequeno, poucas páginas) —
 * sem depender de um bucket/endpoint de arquivo que este subsistema (rotas
 * TanStack Start com Postgres direto, não a API NestJS) ainda não tem.
 */
export class QuotesTable20260903010000 implements MigrationInterface {
  name = 'QuotesTable20260903010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  persona_id uuid references public.agent_personas(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  customer_name text,
  project_description text,
  usage_type text,
  items jsonb not null default '[]'::jsonb,
  subtotal numeric(10,2) not null default 0,
  margin_pct numeric(5,2) not null default 0,
  total numeric(10,2) not null default 0,
  nbr_notes jsonb not null default '[]'::jsonb,
  validity_days integer not null default 7,
  status text not null default 'gerado'
    check (status in ('gerado', 'aprovado', 'recusado', 'expirado')),
  pdf_bytes bytea,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`);
    await queryRunner.query(`
comment on table public.quotes is
  'Orçamentos estruturados gerados pelos Funcionários IA (Bruno = vidros). Uma linha por PDF emitido.';
`);
    await queryRunner.query(`
create index if not exists idx_quotes_account_created
  on public.quotes(account_id, created_at desc);
`);
    await queryRunner.query(`
create index if not exists idx_quotes_persona
  on public.quotes(account_id, persona_id);
`);
    await queryRunner.query(`
alter table public.quotes enable row level security;
`);
    await queryRunner.query(`
create policy "quotes_select_member" on public.quotes
  for select to authenticated using (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "quotes_write_member" on public.quotes
  for all to authenticated
  using (is_account_member(auth.uid(), account_id))
  with check (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create trigger set_quotes_updated_at before update on public.quotes
  for each row execute function public.tg_set_updated_at();
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`drop table if exists public.quotes;`);
  }
}

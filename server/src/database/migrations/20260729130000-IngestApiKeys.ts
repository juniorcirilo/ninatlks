import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Superfície de ingestão para sistema externo (ERP via n8n).
 *
 * Duas peças que faltavam para uma carga automática existir:
 *
 * 1. `contacts.external_id` — a chave do registro no sistema de origem
 *    (código do cliente no ERP). Sem ela a única chave de deduplicação era o
 *    `identifier` derivado de e-mail/telefone, então cliente que troca de
 *    número vira contato novo e não há como dizer "atualize o cliente 40312".
 *    Único por conta, e NULL não conflita (índice parcial), então contato que
 *    nasce no produto continua sem external_id.
 *
 * 2. `account_api_keys` — autenticação máquina-a-máquina. O n8n não tem
 *    sessão de usuário: hoje ele teria que fazer login e guardar o cookie
 *    `sid`, sem escopo e sem revogação. A chave é guardada só como
 *    SHA-256 (`token_hash`) — vazamento do banco não devolve a chave —, com
 *    prefixo visível para a tela conseguir dizer *qual* chave é qual.
 *
 * O guard que valida a chave roda antes do TenantContextInterceptor abrir a
 * transação (é justamente ele quem descobre de que conta a requisição é), então
 * `app.current_account_id` ainda não existe e a policy de RLS desta tabela
 * nunca casaria. Mesma exceção deliberada do AccountMemberGuard: a leitura vai
 * por SECURITY DEFINER (`guard_resolve_api_key`), estreita e já protegida pelo
 * fato de exigir o hash exato de um segredo de 32 bytes.
 *
 * `ip_allowlist` existe porque n8n auto-hospedado tem IP fixo e o cliente pode
 * querer travar nele; fica NULL (sem restrição) por padrão porque n8n Cloud
 * disca de faixas que mudam — travar IP lá quebraria a integração.
 */
export class IngestApiKeys20260729130000 implements MigrationInterface {
  name = 'IngestApiKeys20260729130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
alter table public.contacts
  add column if not exists external_id text;
`);
    await queryRunner.query(`
comment on column public.contacts.external_id is
  'Chave do registro no sistema de origem (ex.: código do cliente no ERP). Única por conta; NULL para contato criado dentro do produto.';
`);
    await queryRunner.query(`
create unique index if not exists contacts_account_external_id_uniq
  on public.contacts(account_id, external_id)
  where external_id is not null;
`);

    await queryRunner.query(`
create table if not exists public.account_api_keys (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  token_prefix text not null,
  token_hash text not null unique,
  scopes text[] not null default array['ingest']::text[],
  ip_allowlist inet[],
  created_by_id uuid references public.profiles(id) on delete set null,
  last_used_at timestamptz,
  last_used_ip text,
  revoked_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`);
    await queryRunner.query(`
create index if not exists account_api_keys_account_idx
  on public.account_api_keys(account_id) where revoked_at is null;
`);

    await queryRunner.query(`
alter table public.account_api_keys enable row level security;
`);
    await queryRunner.query(`
alter table public.account_api_keys force row level security;
`);
    // Só admin enxerga/administra chave de API: é credencial de integração,
    // não dado operacional — membro comum não tem por que listar nem revogar.
    // Nem a policy de select devolve o hash útil sozinho, mas o princípio vale.
    for (const stmt of [
      `drop policy if exists "aak_select_admin" on public.account_api_keys`,
      `drop policy if exists "aak_insert_admin" on public.account_api_keys`,
      `drop policy if exists "aak_update_admin" on public.account_api_keys`,
      `drop policy if exists "aak_delete_admin" on public.account_api_keys`,
      `create policy "aak_select_admin" on public.account_api_keys
         for select to authenticated
         using (has_role(auth.uid(), account_id, 'admin'::app_role))`,
      `create policy "aak_insert_admin" on public.account_api_keys
         for insert to authenticated
         with check (has_role(auth.uid(), account_id, 'admin'::app_role))`,
      `create policy "aak_update_admin" on public.account_api_keys
         for update to authenticated
         using (has_role(auth.uid(), account_id, 'admin'::app_role))`,
      `create policy "aak_delete_admin" on public.account_api_keys
         for delete to authenticated
         using (has_role(auth.uid(), account_id, 'admin'::app_role))`,
    ]) {
      await queryRunner.query(stmt);
    }

    await queryRunner.query(`
drop trigger if exists set_account_api_keys_updated_at on public.account_api_keys;
`);
    await queryRunner.query(`
create trigger set_account_api_keys_updated_at
  before update on public.account_api_keys
  for each row execute function public.tg_set_updated_at();
`);

    // Resolve a chave para (account_id, scopes) e registra o uso na mesma
    // chamada. SECURITY DEFINER pelo mesmo motivo de guard_check_account_membership:
    // roda antes de existir contexto de tenant, então a RLS desta tabela
    // devolveria zero linhas sempre.
    await queryRunner.query(`
create or replace function public.guard_resolve_api_key(_token_hash text, _ip text)
returns table(account_id uuid, key_id uuid, scopes text[], ip_allowlist inet[])
language plpgsql security definer set search_path = public as $$
declare
  v_row public.account_api_keys%rowtype;
begin
  select * into v_row from public.account_api_keys k
   where k.token_hash = _token_hash
     and k.revoked_at is null
     and (k.expires_at is null or k.expires_at > now());
  if not found then
    return;
  end if;

  update public.account_api_keys
     set last_used_at = now(), last_used_ip = _ip
   where id = v_row.id;

  account_id := v_row.account_id;
  key_id := v_row.id;
  scopes := v_row.scopes;
  ip_allowlist := v_row.ip_allowlist;
  return next;
end;
$$;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `drop function if exists public.guard_resolve_api_key(text, text);`,
    );
    await queryRunner.query(`drop table if exists public.account_api_keys;`);
    await queryRunner.query(
      `drop index if exists public.contacts_account_external_id_uniq;`,
    );
    await queryRunner.query(
      `alter table public.contacts drop column if exists external_id;`,
    );
  }
}

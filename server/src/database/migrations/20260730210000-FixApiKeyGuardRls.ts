import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Conserta a autenticação por chave de API, que nunca funcionou.
 *
 * `account_api_keys` foi criada com FORCE ROW LEVEL SECURITY. FORCE faz a RLS
 * valer *também para o dono da tabela* — e o dono é `ninatlks_app`, o mesmo
 * role que a aplicação usa e o mesmo que é dono (definer) de
 * `guard_resolve_api_key`. Então o "vai por SECURITY DEFINER" que a migration
 * original descreve não bypassa nada: a policy de select exige
 * `has_role(auth.uid(), …, 'admin')`, e no caminho de chave de API não existe
 * sessão nem `app.current_user_id`. A função devolvia zero linhas sempre e
 * todo `/ingest/*` respondia 401 "Chave inválida ou revogada".
 *
 * As outras funções `guard_*` não sofrem disso porque as tabelas que elas leem
 * (accounts, account_users, profiles) têm RLS sem FORCE, e aí o dono passa
 * direto. Confirmado com `pg_class.relforcerowsecurity` e reproduzido com
 * chave válida via HTTP antes e depois desta correção.
 *
 * A correção mantém o FORCE e as policies de admin, e acrescenta duas policies
 * estreitas: só a linha cujo `token_hash` é *exatamente* o que a função
 * acabou de colocar em `app.api_key_hash` (set_config local à transação).
 * Quem consegue nomear esse hash já tem o segredo de 32 bytes em mãos — a
 * policy não entrega nada que o portador da chave não pudesse obter, e não
 * abre nada para os outros membros da conta.
 *
 * Alternativas descartadas:
 *  - `no force row level security`: o dono passaria a bypassar a RLS em *todo*
 *    caminho, incluindo as consultas normais da aplicação, e a proteção "só
 *    admin enxerga chave" deixaria de existir na camada do banco.
 *  - trocar o dono da função para `postgres`: resolveria, mas migration roda
 *    como `ninatlks_app`, que não pode reatribuir objeto para superusuário.
 */
export class FixApiKeyGuardRls20260730210000 implements MigrationInterface {
  name = 'FixApiKeyGuardRls20260730210000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const stmt of [
      `drop policy if exists "aak_select_by_token_hash" on public.account_api_keys`,
      `drop policy if exists "aak_update_by_token_hash" on public.account_api_keys`,
      `create policy "aak_select_by_token_hash" on public.account_api_keys
         for select to authenticated
         using (token_hash = nullif(current_setting('app.api_key_hash', true), ''))`,
      // O update existe porque a própria resolução registra last_used_at/ip na
      // mesma ida ao banco — sem policy de update a função estouraria ali.
      `create policy "aak_update_by_token_hash" on public.account_api_keys
         for update to authenticated
         using (token_hash = nullif(current_setting('app.api_key_hash', true), ''))`,
    ]) {
      await queryRunner.query(stmt);
    }

    await queryRunner.query(`
create or replace function public.guard_resolve_api_key(_token_hash text, _ip text)
returns table(account_id uuid, key_id uuid, scopes text[], ip_allowlist inet[])
language plpgsql security definer set search_path = public as $$
declare
  v_row public.account_api_keys%rowtype;
begin
  -- Local à transação (terceiro argumento true): vale para o select e o update
  -- abaixo e não sobra para a próxima consulta da conexão.
  perform set_config('app.api_key_hash', _token_hash, true);

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
      `drop policy if exists "aak_select_by_token_hash" on public.account_api_keys`,
    );
    await queryRunner.query(
      `drop policy if exists "aak_update_by_token_hash" on public.account_api_keys`,
    );
  }
}

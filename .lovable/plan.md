# Plano: Toggle manual de novos registros

Hoje o Nina Talks bloqueia signups automaticamente (via `signup_open()` + trigger `handle_new_user`) assim que existe um admin. O usuário quer trocar isso pelo modelo do Nina Evolution: **um toggle manual** controlado por qualquer usuário autenticado, com default permissivo quando a configuração não existe.

## 1. Banco de dados (migration)

Criar tabela `public.system_settings` com row única (singleton):

```sql
create table public.system_settings (
  id uuid primary key default gen_random_uuid(),
  registration_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.system_settings enable row level security;

-- RLS PERMISSIVAS: qualquer autenticado pode ler/escrever
create policy "Anyone authenticated can read system_settings"
  on public.system_settings for select to authenticated using (true);

create policy "Anon can read system_settings"
  on public.system_settings for select to anon using (true);

create policy "Anyone authenticated can insert system_settings"
  on public.system_settings for insert to authenticated with check (true);

create policy "Anyone authenticated can update system_settings"
  on public.system_settings for update to authenticated using (true) with check (true);

-- Trigger updated_at
create trigger system_settings_updated_at
  before update on public.system_settings
  for each row execute function public.update_updated_at_column();
```

**Atualizar `signup_open()`** para considerar a nova lógica:

```sql
create or replace function public.signup_open()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select registration_enabled from public.system_settings limit 1),
    true  -- default: row inexistente = habilitado
  );
$$;
```

**Atualizar `handle_new_user`** para remover o bloqueio "já existe admin" e usar apenas o toggle:

- Manter Caminho 1 (invite token).
- Substituir Caminho 2/3: se `signup_open()` retorna `false` e não há invite → bloqueia. Se retorna `true` → cria conta (1º vira admin do workspace; demais entram como agent no workspace primário existente, ou criam workspace novo se não houver — mantemos o comportamento single-tenant: se já existe primary, novo usuário entra como `agent` nele).

Decisão padrão: quando o toggle está habilitado e já existe workspace primário, novos signups entram como `agent` no workspace existente (single-tenant continua valendo).

## 2. Frontend

### `src/routes/auth.tsx`
Substituir o `rpc('signup_open')` por leitura direta de `system_settings` com fallback `true`:

```ts
const { data } = await supabase
  .from('system_settings')
  .select('registration_enabled')
  .limit(1)
  .maybeSingle();
setSignupOpen(data ? data.registration_enabled : true);
```

### Nova rota `src/routes/_authenticated/admin-registro.tsx`
Página acessível a **qualquer usuário autenticado** (sem `adminOnly`) com Switch para ligar/desligar registros. Lógica idêntica ao `Admin.tsx` do Nina Evolution: insert se não existe row, update se existe.

### `src/components/layout/AppShell.tsx`
Adicionar item de menu "Registro" apontando para `/admin-registro`, sem flag de admin.

## 3. O que NÃO mudar
- Tabela `invites` e fluxo de convites permanecem.
- `accounts.is_primary` e enforcement single-tenant permanecem.
- Trigger `handle_new_user` mantém Caminho 1 (invite).

## Detalhes técnicos

- Migration única cobrindo `system_settings` + atualização das funções.
- Tipos do Supabase serão regenerados automaticamente após a migration.
- Default permissivo é garantido em duas camadas: SQL (`coalesce(..., true)`) e frontend (`data ? ... : true`).
- RLS permissivas atendem ao requisito explícito do usuário (qualquer autenticado configura).

## Arquivos afetados
- `supabase/migrations/<novo>.sql` (novo)
- `src/routes/auth.tsx` (editar)
- `src/routes/_authenticated/admin-registro.tsx` (novo)
- `src/components/layout/AppShell.tsx` (editar — adicionar item de menu)

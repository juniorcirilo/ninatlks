import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260416211000_seed_defaults.sql.
export class SeedDefaults20260416211000 implements MigrationInterface {
  name = 'SeedDefaults20260416211000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- ============================================================
-- Seed data: default prompt templates for every account.
-- ============================================================
-- Installs three baseline prompts (greeting, auto-reply, resolution)
-- and wires a trigger so new accounts get the same set automatically.

-- ─────────────────────────────────────────────────────────────
-- 1. Function that seeds defaults for a single account
-- ─────────────────────────────────────────────────────────────
create or replace function public.seed_default_prompts(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- greeting ─ first contact on any channel
  insert into public.prompt_versions (
    account_id, slug, version, content, status, author, change_note
  )
  select
    p_account_id, 'greeting', 1,
    $prompt$Você é um atendente de IA receptivo e empático. Cumprimente o cliente pelo nome (se disponível), agradeça pelo contato e pergunte em uma frase como pode ajudar. Use linguagem natural, próxima, sem jargão. Responda no mesmo idioma que o cliente usou.$prompt$,
    'prod', 'human',
    'Seed default — saudação inicial'
  where not exists (
    select 1 from public.prompt_versions
     where account_id = p_account_id and slug = 'greeting'
  );

  -- auto-reply ─ persona auto-reply main prompt
  insert into public.prompt_versions (
    account_id, slug, version, content, status, author, change_note
  )
  select
    p_account_id, 'auto_reply', 1,
    $prompt$Você é o atendente virtual desta marca. Responda com base no histórico da conversa e nos fatos conhecidos do cliente. Seja breve (até 3 frases), útil e consistente com o tom já usado. Nunca invente informação. Se não tiver certeza, ofereça encaminhar para um humano.$prompt$,
    'prod', 'human',
    'Seed default — auto-reply padrão'
  where not exists (
    select 1 from public.prompt_versions
     where account_id = p_account_id and slug = 'auto_reply'
  );

  -- resolution ─ closing message when agent marks conversation resolved
  insert into public.prompt_versions (
    account_id, slug, version, content, status, author, change_note
  )
  select
    p_account_id, 'resolution', 1,
    $prompt$Produza uma mensagem breve de encerramento. Reconheça o que foi resolvido, pergunte se há mais alguma coisa e deixe o canal aberto para o cliente voltar a qualquer momento. Tom cordial e sincero.$prompt$,
    'prod', 'human',
    'Seed default — encerramento'
  where not exists (
    select 1 from public.prompt_versions
     where account_id = p_account_id and slug = 'resolution'
  );
end;
$$;
`);
    await queryRunner.query(`
-- ─────────────────────────────────────────────────────────────
-- 2. Backfill every existing account
-- ─────────────────────────────────────────────────────────────
do $$
declare
  acc record;
begin
  for acc in select id from public.accounts loop
    perform public.seed_default_prompts(acc.id);
  end loop;
end $$;
`);
    await queryRunner.query(`
-- ─────────────────────────────────────────────────────────────
-- 3. Trigger: seed defaults on every new account
-- ─────────────────────────────────────────────────────────────
create or replace function public.tg_seed_default_prompts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_default_prompts(new.id);
  return new;
end;
$$;
`);
    await queryRunner.query(`
drop trigger if exists trg_seed_defaults_on_account on public.accounts;
`);
    await queryRunner.query(`
create trigger trg_seed_defaults_on_account
  after insert on public.accounts
  for each row execute function public.tg_seed_default_prompts();
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'SeedDefaults20260416211000 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}

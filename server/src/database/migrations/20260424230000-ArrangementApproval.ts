import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260424230000_arrangement_approval.sql.
export class ArrangementApproval20260424230000 implements MigrationInterface {
  name = 'ArrangementApproval20260424230000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- ============================================================
-- cobrAI · workflow de aprovação manual de acordos
-- ============================================================
-- Antes da mudança: agente fechava acordo na chamada → automaticamente
-- criava cobrança Asaas + enviava WA + Email.
--
-- Agora: agente cria payment_arrangement com status pendente_aprovacao.
-- Gestor revisa em /acordos e clica Aprovar (dispara proposta) ou
-- Rejeitar (cancela). Auditoria fica em approved_at/approved_by/etc.

-- 1. Adiciona valor ao enum (Postgres exige fora de transação implícita)
alter type public.arrangement_status add value if not exists 'pendente_aprovacao' before 'pendente';
`);
    await queryRunner.query(`
-- 2. Colunas de auditoria de aprovação
alter table public.payment_arrangements
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_by uuid references auth.users(id) on delete set null,
  add column if not exists rejection_reason text;
`);
    await queryRunner.query(`
create index if not exists idx_arrangements_pending_approval
  on public.payment_arrangements(account_id, created_at desc)
  where status = 'pendente_aprovacao';
`);
    await queryRunner.query(`
-- 3. RPC pra aprovar (transicao + audit)
create or replace function public.approve_arrangement(p_arrangement_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_status text;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'auth required';
  end if;

  select account_id, status::text into v_account_id, v_status
    from public.payment_arrangements where id = p_arrangement_id;

  if v_account_id is null then
    raise exception 'arrangement not found';
  end if;

  if not public.is_account_member(v_uid, v_account_id) then
    raise exception 'forbidden';
  end if;

  if v_status <> 'pendente_aprovacao' then
    raise exception 'arrangement is not pending approval (status=%)', v_status;
  end if;

  update public.payment_arrangements
     set status = 'pendente',
         approved_at = now(),
         approved_by = v_uid,
         rejected_at = null,
         rejected_by = null,
         rejection_reason = null
   where id = p_arrangement_id;

  return true;
end;
$$;
`);
    await queryRunner.query(`
grant execute on function public.approve_arrangement(uuid) to authenticated;
`);
    await queryRunner.query(`
-- 4. RPC pra rejeitar
create or replace function public.reject_arrangement(p_arrangement_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_debt_id uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'auth required';
  end if;

  select account_id, debt_id into v_account_id, v_debt_id
    from public.payment_arrangements where id = p_arrangement_id;

  if v_account_id is null then
    raise exception 'arrangement not found';
  end if;

  if not public.is_account_member(v_uid, v_account_id) then
    raise exception 'forbidden';
  end if;

  update public.payment_arrangements
     set status = 'cancelado',
         rejected_at = now(),
         rejected_by = v_uid,
         rejection_reason = p_reason,
         canceled_at = now()
   where id = p_arrangement_id;

  -- Volta a dívida pra aberto se estava em negociação por causa deste acordo
  update public.debts
     set status = 'aberto'
   where id = v_debt_id and status = 'em_negociacao';

  return true;
end;
$$;
`);
    await queryRunner.query(`
grant execute on function public.reject_arrangement(uuid, text) to authenticated;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'ArrangementApproval20260424230000 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}

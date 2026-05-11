alter table public.payment_arrangements
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_by uuid references auth.users(id) on delete set null,
  add column if not exists rejection_reason text;

create index if not exists idx_arrangements_pending_approval
  on public.payment_arrangements(account_id, created_at desc)
  where status = 'pendente_aprovacao';

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

grant execute on function public.approve_arrangement(uuid) to authenticated;

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

  update public.debts
     set status = 'aberto'
   where id = v_debt_id and status = 'em_negociacao';

  return true;
end;
$$;

grant execute on function public.reject_arrangement(uuid, text) to authenticated;
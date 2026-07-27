-- Dispatch retry queue: failed outbound messages get re-tried by cron
create table if not exists public.message_dispatch_queue (
  id bigserial primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  channel_type public.channel_type not null,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_dispatch_queue_pending
  on public.message_dispatch_queue (next_attempt_at)
  where status = 'pending';

create index if not exists idx_dispatch_queue_account
  on public.message_dispatch_queue (account_id, status);

create unique index if not exists uq_dispatch_queue_message
  on public.message_dispatch_queue (message_id);

alter table public.message_dispatch_queue enable row level security;

drop policy if exists "Account members can view dispatch queue" on public.message_dispatch_queue;
create policy "Account members can view dispatch queue"
  on public.message_dispatch_queue
  for select
  to authenticated
  using (public.is_account_member(auth.uid(), account_id));

drop trigger if exists trg_dispatch_queue_updated on public.message_dispatch_queue;
create trigger trg_dispatch_queue_updated
  before update on public.message_dispatch_queue
  for each row execute function public.tg_set_updated_at();

-- Messenger config helper
create or replace function public.messenger_channel_config(_page_id text)
returns table (
  channel_id uuid,
  account_id uuid,
  config jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.account_id, c.config
  from public.channels c
  where c.channel_type = 'messenger'
    and c.enabled = true
    and c.config->>'page_id' = _page_id
  limit 1
$$;
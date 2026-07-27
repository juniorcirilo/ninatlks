-- ============================================================
-- Meta Business Messaging integration — schema hardening
-- ============================================================
-- Adds: customer 24h window tracking, WhatsApp templates library,
-- webhook dedup constraint, dispatch-status index, and channel config helpers.
-- Does NOT encrypt tokens in this migration — `channels.config` stays JSONB
-- (access control via RLS: only account members + service role).

-- ─────────────────────────────────────────────────────────────
-- 1. Conversations: explicit 24h window tracking
-- ─────────────────────────────────────────────────────────────
alter table public.conversations
  add column if not exists last_customer_msg_at timestamptz;

-- Backfill once from existing data
update public.conversations c
   set last_customer_msg_at = (
     select max(m.created_at)
       from public.messages m
      where m.conversation_id = c.id
        and m.sender_type = 'Contact'
   )
 where c.last_customer_msg_at is null;

create index if not exists idx_conversations_customer_window
  on public.conversations(account_id, last_customer_msg_at desc)
  where last_customer_msg_at is not null;

-- Trigger: refresh last_customer_msg_at whenever a Contact message lands
create or replace function public.tg_conv_bump_customer_msg_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sender_type = 'Contact' and new.private is not true then
    update public.conversations
       set last_customer_msg_at = coalesce(new.created_at, now())
     where id = new.conversation_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_conv_bump_customer_msg on public.messages;
create trigger trg_conv_bump_customer_msg
  after insert on public.messages
  for each row execute function public.tg_conv_bump_customer_msg_at();

-- ─────────────────────────────────────────────────────────────
-- 2. WhatsApp templates library (local mirror of Meta templates)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  waba_id text not null,
  name text not null,
  language text not null,                -- e.g. pt_BR, en_US
  category text not null check (category in ('AUTHENTICATION','MARKETING','UTILITY')),
  components jsonb not null default '[]'::jsonb,
  status text not null default 'draft'
    check (status in ('draft','pending','approved','rejected','disabled','paused','appeal_requested')),
  rejected_reason text,
  quality_score text,
  meta_template_id text,                 -- Meta's internal id after submit
  last_synced_at timestamptz,
  created_by_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, name, language)
);

create index if not exists idx_wa_templates_account_status
  on public.whatsapp_templates(account_id, status);
create index if not exists idx_wa_templates_waba
  on public.whatsapp_templates(waba_id);

alter table public.whatsapp_templates enable row level security;

drop policy if exists "wa_templates_select_member" on public.whatsapp_templates;
drop policy if exists "wa_templates_insert_member" on public.whatsapp_templates;
drop policy if exists "wa_templates_update_member" on public.whatsapp_templates;
drop policy if exists "wa_templates_delete_admin"  on public.whatsapp_templates;

create policy "wa_templates_select_member" on public.whatsapp_templates
  for select to authenticated using (is_account_member(auth.uid(), account_id));
create policy "wa_templates_insert_member" on public.whatsapp_templates
  for insert to authenticated with check (is_account_member(auth.uid(), account_id));
create policy "wa_templates_update_member" on public.whatsapp_templates
  for update to authenticated using (is_account_member(auth.uid(), account_id));
create policy "wa_templates_delete_admin" on public.whatsapp_templates
  for delete to authenticated using (has_role(auth.uid(), account_id, 'admin'::app_role));

drop trigger if exists set_whatsapp_templates_updated_at on public.whatsapp_templates;
create trigger set_whatsapp_templates_updated_at
  before update on public.whatsapp_templates
  for each row execute function public.tg_set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 3. Webhook dedup — prevent double-insert of the same external message
-- ─────────────────────────────────────────────────────────────
-- Partial unique so that messages without source_id (agent-composed) don't
-- clash with each other.
create unique index if not exists uq_messages_source
  on public.messages(account_id, source_id)
  where source_id is not null and source_id <> '';

-- ─────────────────────────────────────────────────────────────
-- 4. Dispatch status — fast lookup for failed/pending sends
-- ─────────────────────────────────────────────────────────────
-- We store {status, provider_message_id, failed_reason, sent_at, delivered_at,
-- read_at} inside messages.additional_attributes.dispatch. Partial index
-- speeds up retry-pending scans.
create index if not exists idx_messages_dispatch_status
  on public.messages((additional_attributes -> 'dispatch' ->> 'status'))
  where additional_attributes ? 'dispatch';

-- ─────────────────────────────────────────────────────────────
-- 5. Channel config helper — extract meta fields safely
-- ─────────────────────────────────────────────────────────────
create or replace function public.meta_channel_config(p_channel_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(config, '{}'::jsonb) from public.channels where id = p_channel_id;
$$;

comment on function public.meta_channel_config(uuid) is
  'Returns the raw config JSONB for a channel. Intended for edge functions; RLS on channels still applies to direct selects.';

-- ─────────────────────────────────────────────────────────────
-- 6. Documentation of channel.config shape
-- ─────────────────────────────────────────────────────────────
comment on column public.channels.config is
$$Shape for Meta channels:
WhatsApp: {
  waba_id: string,                -- WhatsApp Business Account ID
  phone_number_id: string,        -- Sender phone number ID
  access_token: string,           -- Permanent System User token
  display_phone_number: string,   -- Optional E.164 for UX
  default_template: string        -- Optional template slug for first-touch outbound
}
Instagram: {
  ig_user_id: string,             -- Instagram Business ID
  page_id: string,                -- Linked Facebook Page ID
  access_token: string,           -- Page access token (long-lived)
  ig_account_id: string           -- Alias for ig_user_id (legacy)
}
Web widget: {
  website_url: string,
  widget_color: string,
  welcome_title: string,
  welcome_tagline: string
}$$;

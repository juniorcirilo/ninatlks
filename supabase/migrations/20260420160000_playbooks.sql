-- ============================================================
-- Phase 5 — Playbooks: pre-canned use-case templates
-- ============================================================
-- A playbook bundles (opening_script, system_prompt, voice_settings,
-- escalation_rules, compliance defaults) for a specific workflow kind so
-- operators don't start from scratch. Used by voice-campaigns and workflow
-- builder ("Load playbook: no_show_recovery").

create table if not exists public.playbooks (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete cascade,  -- nullable → system template
  slug text not null,                                                  -- e.g. "no_show_recovery"
  name text not null,
  description text,
  use_case text not null check (use_case in (
    'no_show_recovery','collection_gentle','collection_firm','collection_final',
    'lead_qualification','post_meeting_followup','appointment_confirmation',
    'reactivation','winback','custom'
  )),

  -- Script defaults applied when user picks this playbook
  script_mode text not null default 'hybrid'
    check (script_mode in ('script_readback','conversational','hybrid')),
  opening_script text,
  system_prompt text,
  voice_id text,                                                       -- ElevenLabs voice default
  voice_settings jsonb default '{}'::jsonb,

  -- Compliance defaults (overridable per-campaign)
  allowed_hours_local jsonb,
  max_attempts_per_day int default 2,
  min_minutes_between_attempts int default 120,
  disclaimer_enabled boolean default true,

  -- Escalation rules applied by default
  escalation_rules jsonb default '[]'::jsonb,

  -- Template variables the UI should collect (name + description)
  required_variables jsonb default '[]'::jsonb,

  is_system boolean not null default false,                            -- seeded vs account-created
  icon text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Unique when account-scoped; separate partial index for system playbooks
-- (because SQL treats NULL as distinct in unique constraints by default).
create unique index if not exists uq_playbooks_account_slug
  on public.playbooks(account_id, slug) where account_id is not null;
create unique index if not exists uq_playbooks_system_slug
  on public.playbooks(slug) where account_id is null;

create index if not exists idx_playbooks_use_case
  on public.playbooks(use_case, is_system desc);

alter table public.playbooks enable row level security;

drop policy if exists "pb_select_member_or_system" on public.playbooks;
drop policy if exists "pb_insert_member" on public.playbooks;
drop policy if exists "pb_update_member" on public.playbooks;
drop policy if exists "pb_delete_admin" on public.playbooks;

-- Everyone on the account can read their own + all system playbooks.
create policy "pb_select_member_or_system" on public.playbooks
  for select to authenticated
  using (
    is_system = true
    or (account_id is not null and is_account_member(auth.uid(), account_id))
  );
create policy "pb_insert_member" on public.playbooks
  for insert to authenticated
  with check (
    account_id is not null
    and is_account_member(auth.uid(), account_id)
    and is_system = false
  );
create policy "pb_update_member" on public.playbooks
  for update to authenticated
  using (
    account_id is not null
    and is_account_member(auth.uid(), account_id)
    and is_system = false
  );
create policy "pb_delete_admin" on public.playbooks
  for delete to authenticated
  using (
    account_id is not null
    and has_role(auth.uid(), account_id, 'admin'::app_role)
    and is_system = false
  );

drop trigger if exists set_playbooks_updated_at on public.playbooks;
create trigger set_playbooks_updated_at
  before update on public.playbooks
  for each row execute function public.tg_set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- Seed system playbooks (account_id=NULL, is_system=true)
-- ─────────────────────────────────────────────────────────────
insert into public.playbooks (
  account_id, slug, name, description, use_case, script_mode,
  opening_script, system_prompt, required_variables,
  allowed_hours_local, max_attempts_per_day, min_minutes_between_attempts,
  escalation_rules, is_system, icon
) values
(
  null, 'no_show_recovery', 'Remarcar no-show',
  'Liga para quem faltou a uma reunião e tenta reagendar um horário.',
  'no_show_recovery', 'hybrid',
  'Olá {{invitee_name}}, aqui é da {{company_name}}. Notamos que você não conseguiu entrar na reunião que tínhamos marcado às {{starts_at}}. Tudo bem com você?',
  'Você é um atendente educado reagendando uma reunião. Tom: caloroso e compreensivo. Objetivo: descobrir se o cliente quer remarcar e oferecer 2 opções de horário. Se ele estiver irritado, não insista — ofereça enviar um link por e-mail/WhatsApp para remarcar sozinho.',
  '[{"key":"invitee_name","description":"Nome do convidado que faltou"},{"key":"company_name","description":"Nome da sua empresa"},{"key":"starts_at","description":"Horário original da reunião"}]'::jsonb,
  '{"mon":[9,18],"tue":[9,18],"wed":[9,18],"thu":[9,18],"fri":[9,18],"sat":null,"sun":null}'::jsonb,
  2, 180,
  '[{"trigger":"explicit_request","action":"transfer_to_human"}]'::jsonb,
  true, 'CalendarX'
),
(
  null, 'collection_gentle_d1', 'Cobrança gentil (D+1)',
  'Primeira abordagem, um dia após o vencimento. Tom amigável, supondo esquecimento.',
  'collection_gentle', 'hybrid',
  'Olá {{customer_name}}, aqui é da {{company_name}}. Notamos que o boleto de {{amount}} venceu ontem e ainda não foi pago. Gostaria de verificar se você precisa de um segundo boleto ou PIX para regularizar?',
  'Tom: educado, prestativo. Trate a inadimplência como provável esquecimento. Ofereça: enviar boleto atualizado por e-mail ou código PIX por SMS. Se o cliente disser que pagou, peça comprovante. Se pedir prazo, aceite até D+7. NUNCA seja agressivo ou ameaçador.',
  '[{"key":"customer_name","description":"Nome do cliente"},{"key":"company_name","description":"Nome da sua empresa"},{"key":"amount","description":"Valor em reais (ex: R$ 149,90)"}]'::jsonb,
  '{"mon":[9,20],"tue":[9,20],"wed":[9,20],"thu":[9,20],"fri":[9,20],"sat":[9,14],"sun":null}'::jsonb,
  2, 240,
  '[{"trigger":"explicit_request","action":"transfer_to_human"}]'::jsonb,
  true, 'CreditCard'
),
(
  null, 'collection_firm_d7', 'Cobrança firme (D+7)',
  'Segunda abordagem, uma semana após o vencimento. Mantém educação mas é mais direta.',
  'collection_firm', 'hybrid',
  'Olá {{customer_name}}, aqui é da {{company_name}} sobre o boleto de {{amount}} que está vencido há {{days_overdue}} dias. Precisamos resolver isso hoje.',
  'Tom: firme mas respeitoso. Cliente já foi lembrado antes. Opções a oferecer em ordem: (1) pagar hoje via PIX com código imediato, (2) parcelar em até 3x, (3) conversar com gerente financeiro (escalate). Se o cliente hostilizar, não revide — transfira para humano. CDC/BR: nunca ameace negativação, nunca ligue 3x no mesmo dia.',
  '[{"key":"customer_name","description":"Nome do cliente"},{"key":"company_name","description":"Nome da sua empresa"},{"key":"amount","description":"Valor total"},{"key":"days_overdue","description":"Dias em atraso"}]'::jsonb,
  '{"mon":[9,20],"tue":[9,20],"wed":[9,20],"thu":[9,20],"fri":[9,20],"sat":[9,14],"sun":null}'::jsonb,
  1, 1440,
  '[{"trigger":"negative_sentiment","action":"transfer_to_human"},{"trigger":"explicit_request","action":"transfer_to_human"}]'::jsonb,
  true, 'AlertCircle'
),
(
  null, 'lead_qualification', 'Qualificação de lead',
  'Liga para lead recém-chegado via form e faz qualificação BANT leve.',
  'lead_qualification', 'conversational',
  'Oi {{lead_name}}, aqui é da {{company_name}}! Vi que você se interessou pela gente em {{lead_source_name}}. Liguei pra entender melhor o que você procura e ver se a gente consegue ajudar.',
  'Tom: consultor, curioso, sem pressão de venda. Objetivo: descobrir orçamento aproximado, prazo e decisor. Fazer 3-4 perguntas curtas. Se BANT alto → propor reunião com SDR humano. Se baixo → agradecer + oferecer material educativo por email. Máximo 4 minutos.',
  '[{"key":"lead_name","description":"Nome do lead"},{"key":"company_name","description":"Nome da sua empresa"},{"key":"lead_source_name","description":"Fonte do lead (ex: Facebook Ads, site, indicação)"}]'::jsonb,
  '{"mon":[9,20],"tue":[9,20],"wed":[9,20],"thu":[9,20],"fri":[9,20],"sat":[9,13],"sun":null}'::jsonb,
  2, 180,
  '[{"trigger":"explicit_request","action":"transfer_to_human"}]'::jsonb,
  true, 'UserPlus'
),
(
  null, 'post_meeting_followup', 'Follow-up pós-reunião',
  'Liga 24-48h após uma reunião para agradecer e reforçar o próximo passo.',
  'post_meeting_followup', 'conversational',
  'Oi {{customer_name}}, aqui é da {{company_name}}. Liguei só pra agradecer pelo tempo de terça e confirmar que você recebeu a proposta que mandamos. Tem alguma dúvida?',
  'Tom: caloroso e curto (2-3 min). Objetivo: descobrir se a proposta avançou internamente ou está travada. Se travou, entender o obstáculo. Se avançou, confirmar data de decisão. Sem pressão.',
  '[{"key":"customer_name","description":"Nome do cliente"},{"key":"company_name","description":"Nome da sua empresa"}]'::jsonb,
  '{"mon":[9,18],"tue":[9,18],"wed":[9,18],"thu":[9,18],"fri":[9,18],"sat":null,"sun":null}'::jsonb,
  1, 720,
  '[{"trigger":"explicit_request","action":"transfer_to_human"}]'::jsonb,
  true, 'MessageSquare'
),
(
  null, 'appointment_confirmation', 'Confirmação de compromisso',
  'Liga 24h antes para confirmar que o cliente vai comparecer.',
  'appointment_confirmation', 'script_readback',
  'Olá {{customer_name}}, aqui é da {{company_name}}. Estou ligando para confirmar nosso compromisso {{appointment_desc}} amanhã às {{appointment_time}}. Você está confirmado?',
  null,
  '[{"key":"customer_name","description":"Nome do cliente"},{"key":"company_name","description":"Nome da sua empresa"},{"key":"appointment_desc","description":"Descrição (ex: atendimento odontológico)"},{"key":"appointment_time","description":"Horário (ex: 14h30)"}]'::jsonb,
  '{"mon":[9,20],"tue":[9,20],"wed":[9,20],"thu":[9,20],"fri":[9,20],"sat":[9,14],"sun":null}'::jsonb,
  1, 0,
  '[{"trigger":"explicit_request","action":"transfer_to_human"}]'::jsonb,
  true, 'CheckCircle2'
)
on conflict do nothing;
-- The uq_playbooks_system_slug partial unique index above catches the dedup.

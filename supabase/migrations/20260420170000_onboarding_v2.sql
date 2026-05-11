-- ============================================================
-- Onboarding wizard v2 — expanded 13-step flow
-- ============================================================
-- Original wizard had 7 generic steps (welcome/org/inbox/keys/invite/persona/done).
-- The new wizard models the actual integration journey: identify the user,
-- pick goals, then conditionally walk through each integration the user said
-- they want. Each step persists into org_onboarding_state.metadata so a
-- mid-wizard browser close never loses progress.
--
-- Steps:
--   1.  welcome              — passive intro
--   2.  empresa              — company name, industry, timezone
--   3.  objetivos            — checkbox: which channels/integrations to enable
--   4.  whatsapp             — Meta WhatsApp (only if objetivos.has("whatsapp"))
--   5.  instagram_messenger  — Meta IG/Messenger (conditional)
--   6.  twilio               — Voice/SMS (conditional)
--   7.  elevenlabs           — TTS (conditional, also auto-skipped if no twilio)
--   8.  deepgram             — STT (conditional, also auto-skipped if no twilio)
--   9.  crm                  — Pipedrive/HubSpot (conditional)
--   10. agenda_billing       — Calendly/Stripe/Asaas (conditional)
--   11. agente               — first AI agent (always)
--   12. regras_ligacao       — voice compliance (conditional, only if twilio)
--   13. done                 — graduation + quick actions
--
-- The wizard knows which steps to skip from objetivos.metadata, so the user
-- only sees the integrations they actually said they wanted.

-- 1. Drop & recreate the CHECK constraint with the new step set.
alter table public.org_onboarding_state
  drop constraint if exists org_onboarding_state_current_step_check;

alter table public.org_onboarding_state
  add constraint org_onboarding_state_current_step_check
  check (current_step in (
    'welcome', 'empresa', 'objetivos',
    'whatsapp', 'instagram_messenger', 'twilio',
    'elevenlabs', 'deepgram', 'crm', 'agenda_billing',
    'agente', 'regras_ligacao',
    'done',
    -- Legacy steps still valid for back-compat with rows already in flight:
    'org', 'inbox', 'keys', 'invite', 'persona'
  ));

-- 2. Migrate any in-flight rows that were sitting on a legacy step → start of v2.
-- Anyone who already finished (completed_at not null) stays as-is.
update public.org_onboarding_state
set current_step = 'welcome',
    completed_steps = '[]'::jsonb
where completed_at is null
  and current_step in ('org', 'inbox', 'keys', 'invite', 'persona');

-- 3. Helper RPC: mark a single step as completed and return the next step the
--    UI should show given the user's selected goals. Keeps the "skip-if-not-in-goals"
--    logic on the server so the client can stay dumb.
create or replace function public.onboarding_advance(
  p_account_id uuid,
  p_current_step text,
  p_payload jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.org_onboarding_state;
  v_goals jsonb;
  v_next text;
  v_completed jsonb;
begin
  -- Authorization: only an admin of this account can advance.
  if not public.has_role(auth.uid(), p_account_id, 'admin'::app_role) then
    raise exception 'forbidden';
  end if;

  select * into v_state from public.org_onboarding_state where account_id = p_account_id;
  if not found then
    insert into public.org_onboarding_state (account_id) values (p_account_id) returning * into v_state;
  end if;

  -- Merge the per-step payload into metadata under the step name so we can
  -- inspect what the user filled at each stage.
  if p_payload is not null and p_payload <> '{}'::jsonb then
    update public.org_onboarding_state
      set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(p_current_step, p_payload)
      where account_id = p_account_id
      returning * into v_state;
  end if;

  -- Update completed_steps array (idempotent).
  v_completed := coalesce(v_state.completed_steps, '[]'::jsonb);
  if not (v_completed @> to_jsonb(p_current_step)) then
    v_completed := v_completed || to_jsonb(p_current_step);
  end if;

  -- Read goals: an array of strings under metadata.objetivos.goals
  v_goals := coalesce(v_state.metadata #> '{objetivos,goals}', '[]'::jsonb);

  -- Decide the next step. Goals-conditional steps are skipped silently.
  v_next := case p_current_step
    when 'welcome'             then 'empresa'
    when 'empresa'             then 'objetivos'
    when 'objetivos'           then 'whatsapp'
    when 'whatsapp'            then 'instagram_messenger'
    when 'instagram_messenger' then 'twilio'
    when 'twilio'              then 'elevenlabs'
    when 'elevenlabs'          then 'deepgram'
    when 'deepgram'            then 'crm'
    when 'crm'                 then 'agenda_billing'
    when 'agenda_billing'      then 'agente'
    when 'agente'              then 'regras_ligacao'
    when 'regras_ligacao'      then 'done'
    else 'done'
  end;

  -- Skip steps the user opted out of via objetivos.goals.
  while v_next not in ('welcome', 'empresa', 'objetivos', 'agente', 'done') loop
    if (v_next = 'whatsapp'            and v_goals @> '"whatsapp"')        then exit; end if;
    if (v_next = 'instagram_messenger' and v_goals @> '"instagram"')       then exit; end if;
    if (v_next = 'twilio'              and (v_goals @> '"voice"' or v_goals @> '"sms"')) then exit; end if;
    if (v_next = 'elevenlabs'          and v_goals @> '"voice"')           then exit; end if;
    if (v_next = 'deepgram'            and v_goals @> '"voice"')           then exit; end if;
    if (v_next = 'crm'                 and v_goals @> '"crm"')             then exit; end if;
    if (v_next = 'agenda_billing'      and (v_goals @> '"calendar"' or v_goals @> '"billing"')) then exit; end if;
    if (v_next = 'regras_ligacao'      and v_goals @> '"voice"')           then exit; end if;

    v_next := case v_next
      when 'whatsapp'            then 'instagram_messenger'
      when 'instagram_messenger' then 'twilio'
      when 'twilio'              then 'elevenlabs'
      when 'elevenlabs'          then 'deepgram'
      when 'deepgram'            then 'crm'
      when 'crm'                 then 'agenda_billing'
      when 'agenda_billing'      then 'agente'
      when 'agente'              then 'regras_ligacao'
      when 'regras_ligacao'      then 'done'
      else 'done'
    end;
  end loop;

  -- Persist the advance.
  update public.org_onboarding_state
    set current_step = v_next,
        completed_steps = v_completed,
        completed_at = case when v_next = 'done' then now() else completed_at end
    where account_id = p_account_id;

  return v_next;
end;
$$;

grant execute on function public.onboarding_advance(uuid, text, jsonb) to authenticated;

-- 4. Helper RPC: jump backward (re-enter a previous step) without losing
--    completed_steps history. Used by the "Voltar" button.
create or replace function public.onboarding_goto(p_account_id uuid, p_step text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), p_account_id, 'admin'::app_role) then
    raise exception 'forbidden';
  end if;

  update public.org_onboarding_state
    set current_step = p_step
    where account_id = p_account_id;
end;
$$;

grant execute on function public.onboarding_goto(uuid, text) to authenticated;

-- Realinha a CHECK constraint de current_step com o wizard atual.
-- Sem isso, qualquer upsert com current_step in
-- ('empresa','elevenlabs','twilio','deepgram','evolution','agente','numero')
-- falha com 23514 e o admin fica preso.

ALTER TABLE public.org_onboarding_state
  DROP CONSTRAINT IF EXISTS org_onboarding_state_current_step_check;

ALTER TABLE public.org_onboarding_state
  ADD CONSTRAINT org_onboarding_state_current_step_check
  CHECK (current_step IN (
    'welcome',
    'empresa',
    'elevenlabs',
    'twilio',
    'deepgram',
    'evolution',
    'agente',
    'numero',
    'done',
    -- Legacy steps mantidos para back-compat com rows antigos
    'org', 'inbox', 'keys', 'invite', 'persona',
    'objetivos', 'whatsapp', 'instagram_messenger',
    'crm', 'agenda_billing', 'regras_ligacao'
  ));
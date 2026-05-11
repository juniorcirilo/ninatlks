-- Relax gates so auto-reply actually fires on fresh personas.
-- Context: default confidence_threshold was 0.7 + persona-auto-reply
-- filtered to status='active', which meant a user who (a) created a persona
-- and (b) deployed to an inbox still saw zero auto-replies unless they also
-- clicked "Treinar" (transitions draft→active). Distillation is a nice-to-have
-- for style cloning, not a precondition for a working agent.

-- 1. Promote any still-draft personas to active. Retired/archived stay put.
update public.agent_personas
set status = 'active'
where status = 'draft';

-- 2. Lower existing deployments to the new default threshold (0.4) when
--    they're still at the legacy 0.7 — won't touch anyone who customized.
update public.agent_persona_deployments
set confidence_threshold = 0.4
where confidence_threshold = 0.7;

-- 3. Promote existing deployments still on 'suggest' autonomy to 'auto' so
--    customers who set things up before the default flip get the new UX.
--    Anyone who deliberately picked 'shadow' keeps it.
update public.agent_persona_deployments
set autonomy = 'auto'
where autonomy = 'suggest';

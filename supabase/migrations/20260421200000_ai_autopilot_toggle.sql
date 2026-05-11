-- Per-conversation AI autopilot toggle.
-- Default true so new conversations always start with the agent driving.
-- Operator flips to false via the ChatPanel "IA / Humano" toggle when they
-- want to take over manually; flipping back resumes auto-reply.
alter table public.conversations
  add column if not exists ai_autopilot_enabled boolean not null default true;

comment on column public.conversations.ai_autopilot_enabled is
  'When false, persona-auto-reply skips this conversation. Toggled explicitly by the operator via the chat header — never auto-flipped on manual sends.';

-- ElevenLabs Conversational AI agent integration.
-- Each persona can be backed by an EL agent that handles STT+LLM+TTS
-- entirely on EL's side. The persona_id stays ours; el_agent_id is the
-- handle we use to register calls, update prompts, and attach knowledge.

alter table public.agent_personas
  add column if not exists elevenlabs_agent_id text,
  add column if not exists elevenlabs_knowledge_base_ids jsonb not null default '[]'::jsonb;

comment on column public.agent_personas.elevenlabs_agent_id is
  'ElevenLabs Conversational AI agent ID. Null = not yet synced. Created by elevenlabs-agent-sync fn when persona is saved.';

comment on column public.agent_personas.elevenlabs_knowledge_base_ids is
  'Array of EL knowledge base document IDs attached to this agent. Managed via /agents persona editor.';

-- Index for quick lookup by el_agent_id (used by personalization webhook).
create index if not exists idx_personas_el_agent_id
  on public.agent_personas(elevenlabs_agent_id)
  where elevenlabs_agent_id is not null;

import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260423110000_persona_advanced_config.sql.
export class PersonaAdvancedConfig20260423110000 implements MigrationInterface {
  name = 'PersonaAdvancedConfig20260423110000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- Advanced config for persona → ElevenLabs Conversational AI agent.
-- Exposes the knobs the operator cares about: turn-taking speed, TTS
-- expressiveness, ASR keywords for domain-specific terms, LLM temperature
-- and a custom first_message. All optional with sensible defaults.
--
-- elevenlabs-agent-sync reads these on sync and maps them into the
-- agent's conversational_config.

alter table public.agent_personas
  add column if not exists first_message text,
  add column if not exists turn_config jsonb not null default
    '{"turn_timeout": 3, "turn_eagerness": "eager", "silence_end_call_timeout": 30}'::jsonb,
  add column if not exists tts_config jsonb not null default
    '{"stability": 0.35, "speed": 1.05, "similarity_boost": 0.85}'::jsonb,
  add column if not exists asr_keywords text[] not null default '{}',
  add column if not exists llm_temperature real not null default 0.5,
  add column if not exists llm_max_tokens int not null default 150,
  add column if not exists llm_model text not null default 'gemini-2.5-flash';
`);
    await queryRunner.query(`
comment on column public.agent_personas.first_message is
  'Opening line the EL agent speaks. Falls back to "Olá, aqui é {name}. Como posso ajudar?" when null.';
`);
    await queryRunner.query(`
comment on column public.agent_personas.turn_config is
  'Turn-taking knobs: turn_timeout (sec before responding to silence), turn_eagerness (eager|normal|cautious), silence_end_call_timeout.';
`);
    await queryRunner.query(`
comment on column public.agent_personas.tts_config is
  'ElevenLabs TTS settings: stability 0-1 (lower=more expressive), speed 0.7-1.3, similarity_boost 0-1.';
`);
    await queryRunner.query(`
comment on column public.agent_personas.asr_keywords is
  'Domain-specific words the STT should lock onto (brand names, product SKUs, etc.). Limits STT misrecognition of niche terms.';
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'PersonaAdvancedConfig20260423110000 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}

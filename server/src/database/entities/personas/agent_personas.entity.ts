import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('agent_personas')
export class AgentPersonas {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'source_user_id', nullable: true })
  sourceUserId?: string | null;

  @Column('text', { name: 'name' })
  name!: string;

  @Column('text', { name: 'description', nullable: true })
  description?: string | null;

  @Column('jsonb', { name: 'config', default: '{}' })
  config!: Record<string, unknown>;

  @Column('text', { name: 'status', default: 'draft' }) // Postgres enum "persona_status" — stored/read as text; DB still enforces the enum constraint.
  status!: string;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;

  @Column('jsonb', { name: 'style_profile', default: '{}' })
  styleProfile!: Record<string, unknown>;

  @Column('text', { name: 'system_prompt', nullable: true })
  systemPrompt?: string | null;

  @Column('text', { name: 'voice_provider', nullable: true })
  voiceProvider?: string | null;

  @Column('text', { name: 'voice_clone_id', nullable: true })
  voiceCloneId?: string | null;

  @Column('jsonb', { name: 'voice_config', default: '{}' })
  voiceConfig!: Record<string, unknown>;

  @Column('integer', { name: 'sample_count', default: 0 })
  sampleCount!: number;

  @Column('integer', { name: 'version', default: 1 })
  version!: number;

  @Column('boolean', { name: 'enabled', default: true })
  enabled!: boolean;

  @Column('text', { name: 'elevenlabs_agent_id', nullable: true })
  elevenlabsAgentId?: string | null;

  @Column('jsonb', { name: 'elevenlabs_knowledge_base_ids', default: '[]' })
  elevenlabsKnowledgeBaseIds!: Record<string, unknown>;

  @Column('text', { name: 'first_message', nullable: true })
  firstMessage?: string | null;

  @Column('jsonb', {
    name: 'turn_config',
    default:
      '{"turn_timeout": 3, "turn_eagerness": "eager", "silence_end_call_timeout": 30}',
  })
  turnConfig!: Record<string, unknown>;

  @Column('jsonb', {
    name: 'tts_config',
    default: '{"speed": 1.05, "stability": 0.35, "similarity_boost": 0.85}',
  })
  ttsConfig!: Record<string, unknown>;

  @Column('text', { name: 'asr_keywords', array: true, default: '{}' })
  asrKeywords!: string[];

  @Column('numeric', { name: 'llm_temperature', default: 0.5 })
  llmTemperature!: number;

  @Column('integer', { name: 'llm_max_tokens', default: 400 })
  llmMaxTokens!: number;

  @Column('text', { name: 'llm_model', default: 'gemini-2.5-flash' })
  llmModel!: string;
}

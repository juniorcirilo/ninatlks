import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('agent_handoffs')
export class AgentHandoffs {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'conversation_id' })
  conversationId!: string;

  @Column('uuid', { name: 'from_persona_id', nullable: true })
  fromPersonaId?: string | null;

  @Column('uuid', { name: 'to_persona_id', nullable: true })
  toPersonaId?: string | null;

  @Column('uuid', { name: 'to_human_user_id', nullable: true })
  toHumanUserId?: string | null;

  @Column('text', { name: 'reason' })
  reason!: string;

  @Column('jsonb', { name: 'context', default: '{}' })
  context!: Record<string, unknown>;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;
}

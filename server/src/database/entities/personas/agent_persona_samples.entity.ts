import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('agent_persona_samples')
export class AgentPersonaSamples {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'persona_id' })
  personaId!: string;

  @Column('uuid', { name: 'message_id', nullable: true })
  messageId?: string | null;

  @Column('uuid', { name: 'conversation_id', nullable: true })
  conversationId?: string | null;

  @Column('text', { name: 'text' })
  text!: string;

  @Column('numeric', { name: 'representativeness', default: 0.5 })
  representativeness!: number;

  @Column('text', { name: 'category', nullable: true })
  category?: string | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;
}

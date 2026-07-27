import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('prompt_templates')
export class PromptTemplates {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'key' })
  key!: string;

  @Column('text', { name: 'name' })
  name!: string;

  @Column('text', { name: 'body' })
  body!: string;

  @Column('jsonb', { name: 'variables', default: '[]' })
  variables!: Record<string, unknown>;

  @Column('boolean', { name: 'enabled', default: true })
  enabled!: boolean;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}

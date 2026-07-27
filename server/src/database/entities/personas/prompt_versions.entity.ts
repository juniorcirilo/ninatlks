import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('prompt_versions')
export class PromptVersions {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'slug' })
  slug!: string;

  @Column('integer', { name: 'version' })
  version!: number;

  @Column('bigint', { name: 'parent_version_id', nullable: true })
  parentVersionId?: string | null;

  @Column('text', { name: 'content' })
  content!: string;

  @Column('jsonb', { name: 'variables', default: '{}' })
  variables!: Record<string, unknown>;

  @Column('text', { name: 'status', default: 'draft' })
  status!: string;

  @Column('numeric', { name: 'eval_score', nullable: true })
  evalScore?: number | null;

  @Column('text', { name: 'change_note', nullable: true })
  changeNote?: string | null;

  @Column('text', { name: 'author', default: 'human' })
  author!: string;

  @Column('uuid', { name: 'created_by_id', nullable: true })
  createdById?: string | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}

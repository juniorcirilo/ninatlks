import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('notifications')
export class Notifications {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'user_id' })
  userId!: string;

  @Column('text', { name: 'kind' })
  kind!: string;

  @Column('text', { name: 'title' })
  title!: string;

  @Column('text', { name: 'body', nullable: true })
  body?: string | null;

  @Column('text', { name: 'link_to', nullable: true })
  linkTo?: string | null;

  @Column('jsonb', { name: 'metadata', default: '{}' })
  metadata!: Record<string, unknown>;

  @Column('timestamptz', { name: 'read_at', nullable: true })
  readAt?: Date | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;
}

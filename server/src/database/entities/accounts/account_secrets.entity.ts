import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('account_secrets')
export class AccountSecrets {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'provider' })
  provider!: string;

  @Column('text', { name: 'key_name' })
  keyName!: string;

  @Column('uuid', { name: 'vault_secret_id' })
  vaultSecretId!: string;

  @Column('jsonb', { name: 'metadata', default: '{}' })
  metadata!: Record<string, unknown>;

  @Column('uuid', { name: 'created_by', nullable: true })
  createdBy?: string | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}

import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('contact_lists')
export class ContactLists {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'name' })
  name!: string;

  @Column('text', { name: 'description', nullable: true })
  description?: string | null;

  @Column('text', { name: 'campaign_kind', nullable: true })
  campaignKind?: string | null;

  /** Agente escolhido ao criar a lista — decide os campos do formulário manual. */
  @Column('uuid', { name: 'persona_id', nullable: true })
  personaId?: string | null;

  @Column('jsonb', { name: 'filters', default: '{}' })
  filters!: Record<string, unknown>;

  /**
   * Chave da lista no sistema de origem. É o `listKey` que o recebimento por
   * webhook usa para achar esta lista em vez de criar outra — única por conta.
   */
  @Column('text', { name: 'external_key', nullable: true })
  externalKey?: string | null;

  @Column('boolean', { name: 'is_dynamic', default: false })
  isDynamic!: boolean;

  @Column('integer', { name: 'member_count', default: 0 })
  memberCount!: number;

  /** 'aberta' | 'finalizada' — ver OperationalListSyncRun20260923010000. */
  @Column('text', { name: 'status', default: 'aberta' })
  status!: string;

  /** Número sequencial só em lista gerada por sincronização de cobrança/orçamento. */
  @Column('bigint', { name: 'list_number', nullable: true })
  listNumber?: number | null;

  @Column('timestamptz', { name: 'finalized_at', nullable: true })
  finalizedAt?: Date | null;

  @Column('uuid', { name: 'created_by_id', nullable: true })
  createdById?: string | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}

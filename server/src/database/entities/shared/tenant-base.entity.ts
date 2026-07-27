import { Column } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Base for the ~99 tables scoped by account_id under RLS
 * (is_account_member/has_role — see database/migrations for the RLS policy port).
 */
export abstract class TenantBaseEntity extends BaseEntity {
  @Column({ name: 'account_id', type: 'uuid' })
  accountId!: string;
}

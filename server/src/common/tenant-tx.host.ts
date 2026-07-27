import { Injectable, Scope } from '@nestjs/common';
import type { EntityManager, QueryRunner } from 'typeorm';

/**
 * Request-scoped handle to the QueryRunner opened by TenantContextInterceptor.
 *
 * All domain data access MUST go through `tx.manager`, never through
 * `@InjectRepository` bound to the global DataSource pool — that pool has no
 * `app.current_user_id` / `app.current_account_id` session vars set, so RLS
 * (FORCE ROW LEVEL SECURITY) will silently return zero rows for it instead of
 * the request's tenant-scoped data. CI should grep for `@InjectRepository`
 * outside common/ and database/ to catch violations.
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantTxHost {
  queryRunner!: QueryRunner;

  get manager(): EntityManager {
    return this.queryRunner.manager;
  }
}

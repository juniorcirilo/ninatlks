import { Injectable, Scope } from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';

/**
 * Thin wrapper over the ported SQL functions (pipeline_get,
 * lead_move_to_stage) — both SECURITY DEFINER and already do their own
 * authorization via auth.uid()/is_account_member() internally, so this
 * service doesn't duplicate that logic in TypeScript. AccountMemberGuard is
 * still the first line of defense.
 */
@Injectable({ scope: Scope.REQUEST })
export class PipelineService {
  constructor(private readonly tx: TenantTxHost) {}

  async get(accountId: string): Promise<unknown> {
    const rows = await this.tx.manager.query<{ pipeline_get: unknown }[]>(
      `SELECT public.pipeline_get($1) AS pipeline_get`,
      [accountId],
    );
    return rows[0].pipeline_get;
  }

  async moveToStage(contactId: string, stageId: string): Promise<void> {
    await this.tx.manager.query(`SELECT public.lead_move_to_stage($1, $2)`, [
      contactId,
      stageId,
    ]);
  }
}

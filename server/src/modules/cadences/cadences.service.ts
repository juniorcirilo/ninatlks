import { Injectable, Scope } from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';
import { UpsertCadenceDto } from './dto/cadence.dto';

export interface CadenceRow {
  id: string;
  name: string;
  description: string | null;
  trigger_event: string;
  trigger_stage_id: string | null;
  enabled: boolean;
  steps: unknown;
  pending_count: number;
  waiting_count: number;
  completed_count: number;
  failed_count: number;
}

/** Ported from src/lib/cadences.ts. */
@Injectable({ scope: Scope.REQUEST })
export class CadencesService {
  constructor(private readonly tx: TenantTxHost) {}

  async list(accountId: string): Promise<CadenceRow[]> {
    const rows = await this.tx.manager.query<
      { followup_list_cadences: CadenceRow[] }[]
    >(`SELECT public.followup_list_cadences($1) AS followup_list_cadences`, [
      accountId,
    ]);
    return rows[0]?.followup_list_cadences ?? [];
  }

  async upsert(accountId: string, dto: UpsertCadenceDto): Promise<string> {
    if (dto.id) {
      await this.tx.manager.query(
        `UPDATE follow_up_cadences
           SET name = $2, description = $3, trigger_event = $4, trigger_stage_id = $5,
               steps = $6::jsonb, enabled = $7, updated_at = now()
         WHERE id = $1 AND account_id = $8`,
        [
          dto.id,
          dto.name,
          dto.description ?? null,
          dto.trigger_event,
          dto.trigger_stage_id ?? null,
          JSON.stringify(dto.steps),
          dto.enabled ?? true,
          accountId,
        ],
      );
      return dto.id;
    }

    const rows = await this.tx.manager.query<{ id: string }[]>(
      `INSERT INTO follow_up_cadences
         (account_id, name, description, trigger_event, trigger_stage_id, steps, enabled, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, now(), now())
       RETURNING id`,
      [
        accountId,
        dto.name,
        dto.description ?? null,
        dto.trigger_event,
        dto.trigger_stage_id ?? null,
        JSON.stringify(dto.steps),
        dto.enabled ?? true,
      ],
    );
    return rows[0].id;
  }

  async remove(accountId: string, id: string): Promise<void> {
    await this.tx.manager.query(
      `DELETE FROM follow_up_cadences WHERE id = $1 AND account_id = $2`,
      [id, accountId],
    );
  }

  async enroll(cadenceId: string, contactId: string): Promise<string> {
    const rows = await this.tx.manager.query<
      { cadence_enroll_contact: string }[]
    >(
      `SELECT public.cadence_enroll_contact($1, $2) AS cadence_enroll_contact`,
      [cadenceId, contactId],
    );
    return rows[0].cadence_enroll_contact;
  }
}

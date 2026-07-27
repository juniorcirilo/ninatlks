import { Injectable, Scope } from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';

export interface CallSummaryRow {
  id: string;
  direction: string;
  status: string;
  from_number: string;
  to_number: string;
  started_at: Date | null;
  ended_at: Date | null;
  duration_seconds: number;
  outcome_category: string | null;
  outcome_summary: string | null;
  sentiment: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  recording_url: string | null;
  transcript: unknown;
  contact_name: string | null;
}

export interface CallDetailRow extends CallSummaryRow {
  account_id: string;
  recording_storage_path: string | null;
  classification: Record<string, unknown> | null;
  ai_summary: string | null;
}

/** Ported from src/lib/calls.ts (read-only voice_calls + contact-name join). */
@Injectable({ scope: Scope.REQUEST })
export class CallsService {
  constructor(private readonly tx: TenantTxHost) {}

  async list(
    accountId: string,
    filter: { direction?: 'inbound' | 'outbound' | 'all'; limit?: number } = {},
  ): Promise<CallSummaryRow[]> {
    const { direction = 'all', limit = 100 } = filter;
    return this.tx.manager.query<CallSummaryRow[]>(
      `SELECT vc.id, vc.direction, vc.status, vc.from_number, vc.to_number, vc.started_at, vc.ended_at,
              vc.duration_seconds, vc.outcome_category, vc.outcome_summary, vc.sentiment, vc.metadata,
              vc.recording_url, vc.transcript,
              c.name AS contact_name
         FROM voice_calls vc
         LEFT JOIN contacts c
           ON c.account_id = vc.account_id
          AND c.phone_number = (CASE WHEN vc.direction = 'outbound' THEN vc.to_number ELSE vc.from_number END)
        WHERE vc.account_id = $1
          AND ($2::text IS NULL OR vc.direction::text = $2)
        ORDER BY vc.started_at DESC NULLS LAST
        LIMIT $3`,
      [accountId, direction === 'all' ? null : direction, limit],
    );
  }

  async detail(
    accountId: string,
    callId: string,
  ): Promise<CallDetailRow | null> {
    const rows = await this.tx.manager.query<CallDetailRow[]>(
      `SELECT vc.id, vc.account_id, vc.direction, vc.status, vc.from_number, vc.to_number, vc.started_at,
              vc.ended_at, vc.duration_seconds, vc.outcome_category, vc.outcome_summary, vc.sentiment,
              vc.metadata, vc.recording_url, vc.recording_storage_path, vc.transcript, vc.classification,
              vc.ai_summary,
              c.name AS contact_name
         FROM voice_calls vc
         LEFT JOIN contacts c
           ON c.account_id = vc.account_id
          AND c.phone_number = (CASE WHEN vc.direction = 'outbound' THEN vc.to_number ELSE vc.from_number END)
        WHERE vc.account_id = $1 AND vc.id = $2
        LIMIT 1`,
      [accountId, callId],
    );
    return rows[0] ?? null;
  }
}

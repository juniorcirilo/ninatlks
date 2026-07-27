import { Injectable, Scope } from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';
import { Accounts } from '../../database/entities/accounts/accounts.entity';

export interface DncEntry {
  id: number;
  account_id: string;
  phone_number: string;
  reason: string | null;
  source: string | null;
  notes: string | null;
  created_at: Date;
}

@Injectable({ scope: Scope.REQUEST })
export class ComplianceService {
  constructor(private readonly tx: TenantTxHost) {}

  async listDnc(accountId: string): Promise<DncEntry[]> {
    return this.tx.manager.query<DncEntry[]>(
      `SELECT id, account_id, phone_number, reason, source, notes, created_at
       FROM public.dnc_list
       WHERE account_id = $1
       ORDER BY created_at DESC`,
      [accountId],
    );
  }

  async addToDnc(
    accountId: string,
    phoneNumber: string,
    reason?: string,
    notes?: string,
  ): Promise<void> {
    await this.tx.manager.query(
      `INSERT INTO public.dnc_list (account_id, phone_number, reason, notes)
       VALUES ($1, $2, $3, $4)`,
      [accountId, phoneNumber, reason ?? 'manual', notes ?? null],
    );
  }

  async removeFromDnc(accountId: string, id: number): Promise<void> {
    await this.tx.manager.query(
      `DELETE FROM public.dnc_list WHERE id = $1 AND account_id = $2`,
      [id, accountId],
    );
  }

  async getCompliancePolicy(
    accountId: string,
  ): Promise<Record<string, unknown>> {
    const account = await this.tx.manager.findOne(Accounts, {
      where: { id: accountId },
      select: { internalAttributes: true },
    });
    const attrs = account?.internalAttributes ?? {};
    return (attrs.compliance as Record<string, unknown>) ?? {};
  }

  async saveCompliancePolicy(
    accountId: string,
    policy: Record<string, unknown>,
  ): Promise<void> {
    const account = await this.tx.manager.findOne(Accounts, {
      where: { id: accountId },
      select: { internalAttributes: true },
    });
    const attrs = { ...(account?.internalAttributes ?? {}) } as Record<
      string,
      unknown
    >;
    attrs.compliance = policy;
    await this.tx.manager
      .createQueryBuilder()
      .update(Accounts)
      .set({ internalAttributes: attrs } as Record<string, unknown>)
      .where('id = :accountId', { accountId })
      .execute();
  }
}

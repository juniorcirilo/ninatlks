import { Injectable, Scope } from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';

export interface MergeResult {
  primary_id: string;
  merged_count: number;
  moved_conversations: number;
  moved_contact_inboxes: number;
}

@Injectable({ scope: Scope.REQUEST })
export class GdprService {
  constructor(private readonly tx: TenantTxHost) {}

  /**
   * lgpd_delete_contact is SECURITY DEFINER and checks has_role(...,'admin')
   * itself — RolesGuard at the controller is defense-in-depth, not the only
   * gate.
   */
  async lgpdDeleteContact(contactId: string): Promise<void> {
    await this.tx.manager.query(`SELECT public.lgpd_delete_contact($1)`, [
      contactId,
    ]);
  }

  /**
   * merge_contacts is SECURITY DEFINER but, unlike the rest of the ported
   * RPCs, does NOT check the caller's role itself — the original edge
   * function did that check in TypeScript before calling it with the
   * service-role key. RolesGuard('admin') at the controller is the ONLY
   * authorization gate here, not a second layer — do not remove it.
   *
   * `accountId` (from the guarded route, already verified by
   * AccountMemberGuard/RolesGuard) is passed through only so callers keep
   * an explicit account-scoped signature — the actual enforcement is the
   * `app.current_account_id` check inside merge_contacts itself (see
   * 20260908010000-MergeContactsAccountScopeAndCascadeFix.ts), which
   * rejects the merge if the contacts' real account doesn't match the
   * request's tenant, closing an IDOR where primaryId/duplicateIds could
   * belong to a different account than the URL's.
   */
  async mergeContacts(
    accountId: string,
    primaryId: string,
    duplicateIds: string[],
  ): Promise<MergeResult> {
    void accountId;
    const rows = await this.tx.manager.query<MergeResult[]>(
      `SELECT * FROM public.merge_contacts($1, $2)`,
      [primaryId, duplicateIds],
    );
    return rows[0];
  }
}

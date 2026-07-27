import { Injectable, Scope } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantTxHost } from '../../common/tenant-tx.host';

export interface AccountSecretEntry {
  provider: string;
  key_name: string;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

/**
 * set_account_secret/delete_account_secret/list_account_secrets are
 * SECURITY DEFINER and self-check has_role(...,'admin') — safe to call
 * directly via TenantTxHost. get_account_secret/get_account_secrets_bulk
 * instead check current_setting('request.jwt.claim.role') = 'service_role',
 * a PostgREST/Supabase-JWT concept this backend never sets (session-cookie
 * auth, no JWT claims GUC) — those two RPCs are effectively unreachable
 * here. getInternal()/getInternalBulk() below read vault.decrypted_secrets
 * directly via DataSource instead, mirroring what those RPCs did; this
 * service is only ever injected into other backend services (Twilio/
 * ElevenLabs/Evolution/Meta integrations), never exposed on a public route,
 * so that's the equivalent trust boundary.
 */
@Injectable({ scope: Scope.REQUEST })
export class SecretsService {
  constructor(
    private readonly tx: TenantTxHost,
    private readonly dataSource: DataSource,
  ) {}

  async list(accountId: string): Promise<AccountSecretEntry[]> {
    return this.tx.manager.query<AccountSecretEntry[]>(
      `SELECT * FROM public.list_account_secrets($1)`,
      [accountId],
    );
  }

  async set(
    accountId: string,
    provider: string,
    keyName: string,
    value: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.tx.manager.query(
      `SELECT public.set_account_secret($1, $2, $3, $4, $5::jsonb)`,
      [accountId, provider, keyName, value, JSON.stringify(metadata ?? {})],
    );
  }

  async delete(
    accountId: string,
    provider: string,
    keyName: string,
  ): Promise<boolean> {
    const rows = await this.tx.manager.query<
      { delete_account_secret: boolean }[]
    >(
      `SELECT public.delete_account_secret($1, $2, $3) AS delete_account_secret`,
      [accountId, provider, keyName],
    );
    return rows[0]?.delete_account_secret ?? false;
  }

  /** Internal use only (other backend services) — bypasses the RPC's unreachable JWT-role check. */
  async getInternal(
    accountId: string,
    provider: string,
    keyName: string,
  ): Promise<string | null> {
    const rows = await this.dataSource.query<{ decrypted_secret: string }[]>(
      `SELECT vs.decrypted_secret
       FROM public.account_secrets s
       JOIN vault.decrypted_secrets vs ON vs.id = s.vault_secret_id
       WHERE s.account_id = $1 AND s.provider = $2 AND s.key_name = $3`,
      [accountId, provider, keyName],
    );
    return rows[0]?.decrypted_secret ?? null;
  }

  /** Internal use only — all key_name -> value pairs for a provider. */
  async getInternalBulk(
    accountId: string,
    provider: string,
  ): Promise<Record<string, string>> {
    const rows = await this.dataSource.query<
      { key_name: string; decrypted_secret: string }[]
    >(
      `SELECT s.key_name, vs.decrypted_secret
       FROM public.account_secrets s
       JOIN vault.decrypted_secrets vs ON vs.id = s.vault_secret_id
       WHERE s.account_id = $1 AND s.provider = $2`,
      [accountId, provider],
    );
    return Object.fromEntries(
      rows.map((r) => [r.key_name, r.decrypted_secret]),
    );
  }
}

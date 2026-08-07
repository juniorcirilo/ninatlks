import { Injectable, NotFoundException, Scope } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { TenantTxHost } from '../../common/tenant-tx.host';

export interface ApiKeyRow {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  ip_allowlist: string[] | null;
  last_used_at: Date | null;
  last_used_ip: string | null;
  revoked_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
}

/**
 * Administração das chaves de integração. Ao contrário do ApiKeyGuard, este
 * serviço roda no caminho normal com sessão e RLS (a policy da tabela exige
 * admin da conta), então usa TenantTxHost como todo serviço de domínio.
 */
@Injectable({ scope: Scope.REQUEST })
export class ApiKeysService {
  constructor(private readonly tx: TenantTxHost) {}

  async list(accountId: string): Promise<ApiKeyRow[]> {
    return this.tx.manager.query<ApiKeyRow[]>(
      `SELECT id, name, token_prefix, scopes, ip_allowlist, last_used_at,
              last_used_ip, revoked_at, expires_at, created_at
         FROM public.account_api_keys
        WHERE account_id = $1
        ORDER BY created_at DESC`,
      [accountId],
    );
  }

  /**
   * Devolve a chave em claro uma única vez — o banco guarda só o SHA-256, e
   * não existe caminho para reexibi-la depois. Perdeu, gera outra e revoga a
   * antiga.
   *
   * Formato `ntk_<prefixo>_<segredo>`: o prefixo é gravado em claro só para a
   * tela conseguir dizer qual chave é qual sem revelar nada útil, e o segredo
   * são 32 bytes de aleatoriedade criptográfica.
   */
  async create(
    accountId: string,
    userId: string,
    input: {
      name: string;
      ipAllowlist?: string[];
      expiresAt?: string;
    },
  ): Promise<{ id: string; token: string; tokenPrefix: string }> {
    const prefix = randomBytes(4).toString('hex');
    const secret = randomBytes(32).toString('base64url');
    const token = `ntk_${prefix}_${secret}`;
    const tokenHash = createHash('sha256').update(token).digest('hex');

    const rows = await this.tx.manager.query<{ id: string }[]>(
      `INSERT INTO public.account_api_keys
         (account_id, name, token_prefix, token_hash, created_by_id, ip_allowlist, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6::inet[], $7)
       RETURNING id`,
      [
        accountId,
        input.name,
        prefix,
        tokenHash,
        userId,
        input.ipAllowlist?.length ? input.ipAllowlist : null,
        input.expiresAt ?? null,
      ],
    );

    return { id: rows[0].id, token, tokenPrefix: prefix };
  }

  /**
   * Revoga em vez de apagar: a linha continua existindo com last_used_at e
   * last_used_ip, que é o que responde "essa chave que vazou chegou a ser
   * usada, e de onde?".
   */
  async revoke(accountId: string, id: string): Promise<{ ok: true }> {
    // SELECT antes do UPDATE, e não `UPDATE ... RETURNING`: o retorno de
    // query() para UPDATE com RETURNING não é a lista de linhas (vem
    // `[linhas, afetadas]`), então checar `.length` daria 2 mesmo sem ter
    // atualizado nada — o mesmo tropeço já documentado no dispatcher de
    // campanha.
    const found = await this.tx.manager.query<{ id: string }[]>(
      `SELECT id FROM public.account_api_keys
        WHERE id = $1 AND account_id = $2 AND revoked_at IS NULL`,
      [id, accountId],
    );
    if (!found.length) {
      throw new NotFoundException('Chave não encontrada ou já revogada');
    }
    await this.tx.manager.query(
      `UPDATE public.account_api_keys SET revoked_at = now() WHERE id = $1`,
      [id],
    );
    return { ok: true };
  }
}

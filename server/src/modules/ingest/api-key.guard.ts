import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { ApiKeyRequest } from './api-key-request';

/**
 * Autenticação máquina-a-máquina para as rotas de ingestão. O chamador é um
 * n8n (auto-hospedado ou Cloud), não um navegador com sessão: manda
 * `Authorization: Bearer ntk_<prefixo>_<segredo>` e a conta sai do próprio
 * segredo, nunca da URL — não existe rota `/accounts/:accountId/ingest`
 * justamente para uma chave não conseguir apontar para conta alheia.
 *
 * Consulta direta pelo DataSource, e não pelo TenantTxHost, pela mesma razão
 * do AccountMemberGuard: roda antes de existir contexto de tenant (descobrir
 * qual é a conta é o serviço que este guard presta), então a RLS de
 * `account_api_keys` devolveria zero linhas. Vai pela SECURITY DEFINER
 * `guard_resolve_api_key`, que já registra `last_used_at`/`last_used_ip` na
 * mesma ida ao banco.
 *
 * A comparação é por SHA-256 do token: o banco só guarda o hash, e um hash é
 * de tamanho fixo — não há canal lateral de tempo comparando o segredo em si.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ApiKeyRequest>();

    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) {
      throw new UnauthorizedException(
        'Envie a chave em Authorization: Bearer ntk_...',
      );
    }

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const ip = clientIp(req);

    const rows = await this.dataSource.query<
      {
        account_id: string;
        key_id: string;
        scopes: string[];
        ip_allowlist: string[] | null;
      }[]
    >(`SELECT * FROM public.guard_resolve_api_key($1, $2)`, [tokenHash, ip]);

    const key = rows[0];
    if (!key) throw new UnauthorizedException('Chave inválida ou revogada');

    // Allowlist é opcional de propósito: n8n auto-hospedado sai de um IP fixo
    // e vale travar; n8n Cloud sai de faixas que a própria n8n muda sem aviso,
    // e travar lá derrubaria a integração numa manhã qualquer.
    if (key.ip_allowlist && key.ip_allowlist.length > 0) {
      const allowed = key.ip_allowlist.some(
        (entry) => entry.split('/')[0] === ip,
      );
      if (!allowed) {
        throw new ForbiddenException(`IP ${ip} não autorizado para esta chave`);
      }
    }

    if (!key.scopes.includes('ingest')) {
      throw new ForbiddenException('Chave sem escopo "ingest"');
    }

    req.apiKey = {
      id: key.key_id,
      accountId: key.account_id,
      scopes: key.scopes,
    };
    return true;
  }
}

/**
 * O IP real vem do X-Forwarded-For quando existe: em produção o nginx faz o
 * proxy (ver .env), então `req.ip` seria sempre o do próprio proxy e tanto o
 * registro de uso quanto a allowlist ficariam inúteis.
 */
function clientIp(req: ApiKeyRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = Array.isArray(fwd) ? fwd[0] : fwd;
  if (first) return first.split(',')[0].trim();
  return req.ip ?? '';
}

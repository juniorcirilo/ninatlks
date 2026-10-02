import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { createHash, timingSafeEqual } from 'node:crypto';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type {
  AuthenticatedRequest,
  RequestUser,
} from '../types/authenticated-request';

/**
 * Áreas que a chave do node n8n nunca alcança, mesmo sendo global: login e
 * sessão, segredos de provedores, chaves de API e gestão de equipe/convites.
 * Quem precisa disso usa a sessão de um usuário.
 */
const NODE_KEY_DENIED =
  /^(?:\/api)?\/(?:auth(?:\/|$)|accounts\/[^/]+\/(?:secrets|api-keys|members|invites)(?:\/|$))/;

@Injectable()
export class SessionAuthGuard extends AuthGuard('session') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const nodeUser = this.resolveNodeKey(req);
    if (nodeUser) {
      req.user = nodeUser;
      return true;
    }
    return super.canActivate(context);
  }

  /**
   * Chave global do node n8n-nodes-utalks: `Authorization: Bearer <chave>`,
   * igual a N8N_NODE_API_KEY. Age como o usuário N8N_NODE_USER_ID — as rotas
   * por conta continuam passando pelo AccountMemberGuard, então a chave só
   * alcança contas em que esse usuário é membro, com o papel dele.
   *
   * Desligada quando qualquer uma das duas variáveis falta, ou quando a chave
   * tem menos de 32 caracteres (uma chave curta é adivinhável por tentativa).
   * Qualquer outro Bearer segue para a autenticação de sessão normal.
   */
  private resolveNodeKey(req: AuthenticatedRequest): RequestUser | null {
    const key = process.env.N8N_NODE_API_KEY ?? '';
    const userId = process.env.N8N_NODE_USER_ID ?? '';
    if (key.length < 32 || !userId) return null;

    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return null;

    // Hash dos dois lados: tamanho fixo, sem canal de tempo no segredo.
    const a = createHash('sha256').update(token).digest();
    const b = createHash('sha256').update(key).digest();
    if (!timingSafeEqual(a, b)) return null;

    const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
    if (NODE_KEY_DENIED.test(path)) {
      throw new ForbiddenException('Rota não disponível para a chave do node');
    }
    return { id: userId, sessionId: 'n8n-node' };
  }
}

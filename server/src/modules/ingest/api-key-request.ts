import type { Request } from 'express';

export interface ResolvedApiKey {
  id: string;
  accountId: string;
  scopes: string[];
}

/**
 * Requisição autenticada por chave de API. Não estende AuthenticatedRequest de
 * propósito: aqui não existe `user` nem `activeAccountId` — a conta vem do
 * segredo, e as rotas são @Public() (fora do SessionAuthGuard e do
 * TenantContextInterceptor), então nada abaixo pode assumir sessão.
 */
export interface ApiKeyRequest extends Request {
  apiKey: ResolvedApiKey;
}

import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface McpTokenPayload {
  /** conta */
  acc: string;
  /** conversa atual (para auditoria) */
  conv: string | null;
  /** agente (persona) */
  persona: string | null;
  /** expiração (epoch s) */
  exp: number;
}

/**
 * Tokens efêmeros do servidor MCP interno: presos à conta/conversa e
 * assinados com um segredo que só existe na memória deste processo (quem
 * emite e quem valida é o mesmo processo, então não há segredo a configurar).
 */
@Injectable()
export class McpTokenService {
  private readonly secret = randomBytes(32);

  private sign(data: string): string {
    return createHmac('sha256', this.secret).update(data).digest('base64url');
  }

  mint(
    p: {
      accountId: string;
      conversationId?: string | null;
      personaId?: string | null;
    },
    ttlSeconds = 300,
  ): string {
    const payload: McpTokenPayload = {
      acc: p.accountId,
      conv: p.conversationId ?? null,
      persona: p.personaId ?? null,
      exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${this.sign(body)}`;
  }

  verify(token: string | undefined): McpTokenPayload | null {
    if (!token) return null;
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = this.sign(body);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const p = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf8'),
      ) as McpTokenPayload;
      return p.exp > Date.now() / 1000 ? p : null;
    } catch {
      return null;
    }
  }
}

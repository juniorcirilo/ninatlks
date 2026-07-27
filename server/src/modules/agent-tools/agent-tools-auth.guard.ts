import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/**
 * Ported from the `x-el-webhook-secret` check duplicated across every
 * supabase/functions/agent-tool-X/index.ts (X = confirm-meeting, get-availability,
 * qualify-lead, reschedule-meeting, schedule-meeting) — these are tool webhooks the
 * ElevenLabs agent calls DURING a live call (function-calling), so there's
 * no user session; auth is a single shared secret header, same as the
 * original.
 */
@Injectable()
export class AgentToolsAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const expected = process.env.ELEVENLABS_WEBHOOK_SECRET ?? '';
    const received = (req.headers['x-el-webhook-secret'] as string) ?? '';
    if (!expected || !received || !this.safeEqual(received, expected)) {
      throw new UnauthorizedException('unauthorized');
    }
    return true;
  }

  private safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}

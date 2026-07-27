import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';
import type { Request } from 'express';
import { SessionService } from '../session.service';
import type { RequestUser } from '../../../common/types/authenticated-request';

/**
 * `passport-custom`, not `passport-jwt`: there's no signature to verify —
 * the cookie carries an opaque token looked up against the `sessions` table
 * (SessionService), so plugging into Passport's Strategy/Guard idiom doesn't
 * require pretending it's a JWT.
 *
 * Idiomatic @nestjs/passport shape: validate() takes whatever passport-custom's
 * verify function receives (just `req`) and returns the user or throws — the
 * PassportStrategy mixin wraps this into passport's done(err, user) callback
 * itself, it does not forward `done` to validate().
 */
@Injectable()
export class SessionStrategy extends PassportStrategy(Strategy, 'session') {
  constructor(private readonly sessionService: SessionService) {
    super();
  }

  async validate(req: Request): Promise<RequestUser> {
    const cookieName = process.env.SESSION_COOKIE_NAME ?? 'sid';
    const token = (req.cookies as Record<string, string> | undefined)?.[
      cookieName
    ];
    if (!token) throw new UnauthorizedException();

    const session = await this.sessionService.resolve(token);
    if (!session) throw new UnauthorizedException();

    this.sessionService.touchLastSeen(session.id);

    return { id: session.userId, sessionId: session.id };
  }
}

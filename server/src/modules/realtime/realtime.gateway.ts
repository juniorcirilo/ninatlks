import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { DataSource } from 'typeorm';
import { SessionService } from '../auth/session.service';

export interface AppChangePayload {
  table: string;
  op: 'INSERT' | 'UPDATE' | 'DELETE';
  id: string;
  accountId: string | null;
  userId?: string;
}

function readCookie(
  cookieHeader: string | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? 'sid';

/**
 * Replaces the 6 uses of Supabase `postgres_changes` — clients join
 * `account:{accountId}` (one room per membership) and `user:{userId}`
 * rooms on connect, driven entirely server-side from the session (never
 * from client-supplied ids), so cross-tenant leakage isn't possible.
 * PgListenService feeds `broadcast()` from the `app_changes` LISTEN
 * channel. Requires @socket.io/redis-adapter (wired in main.ts) to fan out
 * correctly once there's more than one API replica.
 */
@WebSocketGateway({
  cors: { origin: process.env.WEB_ORIGIN ?? true, credentials: true },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly sessionService: SessionService,
    private readonly dataSource: DataSource,
  ) {}

  async handleConnection(socket: Socket): Promise<void> {
    try {
      const token = readCookie(socket.handshake.headers.cookie, COOKIE_NAME);
      if (!token) throw new Error('no session cookie');

      const session = await this.sessionService.resolve(token);
      if (!session) throw new Error('invalid session');

      // `account_users` has RLS keyed on auth.uid(), never set on this
      // pre-tenant-context handshake connection — same reasoning as the
      // Guards, see migrations/20260720110000-RealtimeMembershipBypass.ts.
      const memberships = await this.dataSource.query<
        { account_id: string }[]
      >(`SELECT * FROM public.auth_get_account_ids_for_user($1)`, [
        session.userId,
      ]);

      await socket.join(`user:${session.userId}`);
      for (const m of memberships) {
        await socket.join(`account:${m.account_id}`);
      }
    } catch (err) {
      this.logger.debug(
        `Rejected socket connection: ${(err as Error).message}`,
      );
      socket.disconnect(true);
    }
  }

  handleDisconnect(): void {
    // Rooms are cleaned up automatically by socket.io on disconnect.
  }

  broadcast(payload: AppChangePayload): void {
    // Tables that carry a userId (currently just `notifications`) are
    // user-private — route ONLY to that user's room. Broadcasting to the
    // whole account room too would leak to every teammate the fact that a
    // specific other user got a specific notification.
    if (payload.userId) {
      this.server.to(`user:${payload.userId}`).emit('app_change', payload);
      return;
    }
    if (payload.accountId) {
      this.server
        .to(`account:${payload.accountId}`)
        .emit('app_change', payload);
    }
  }
}

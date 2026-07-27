import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';

/**
 * Socket.io rooms are local to the process by default. Without this, a
 * client connected to pod A never receives an event broadcast from pod B —
 * breaks silently the moment the API scales past one replica. Wired up from
 * the start per the migration plan, even though we only run one instance
 * locally today.
 */
export class RealtimeIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(redisUrl: string): Promise<void> {
    const pubClient = new Redis(redisUrl);
    const subClient = pubClient.duplicate();
    await Promise.all([
      pubClient.status === 'ready'
        ? undefined
        : new Promise((resolve) => pubClient.once('ready', resolve)),
      subClient.status === 'ready'
        ? undefined
        : new Promise((resolve) => subClient.once('ready', resolve)),
    ]);
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, options) as {
      adapter: (a: ReturnType<typeof createAdapter>) => void;
    };
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}

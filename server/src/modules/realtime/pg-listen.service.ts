import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import { RealtimeGateway, AppChangePayload } from './realtime.gateway';

/**
 * LISTEN requires a long-lived, dedicated connection — incompatible with a
 * round-robin pool (TypeORM's pool would eventually hand this session to an
 * unrelated request). Opens its own `pg.Client` outside TypeOrmModule
 * entirely, kept open for the process lifetime, with a reconnect loop if
 * the server drops it (e.g. Postgres restart).
 */
@Injectable()
export class PgListenService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PgListenService.name);
  private client?: Client;
  private stopped = false;

  constructor(
    private readonly config: ConfigService,
    private readonly gateway: RealtimeGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    void this.client?.end();
  }

  private async connect(): Promise<void> {
    const client = new Client({
      connectionString: this.config.get<string>('DATABASE_URL'),
    });
    client.on('error', (err) => {
      this.logger.warn(`LISTEN connection error: ${err.message}`);
    });
    client.on('end', () => {
      if (this.stopped) return;
      this.logger.warn('LISTEN connection closed — reconnecting in 3s');
      setTimeout(() => void this.connect(), 3000);
    });
    client.on('notification', (msg) => {
      if (msg.channel !== 'app_changes' || !msg.payload) return;
      try {
        this.gateway.broadcast(JSON.parse(msg.payload) as AppChangePayload);
      } catch (err) {
        this.logger.warn(
          `Malformed app_changes payload: ${(err as Error).message}`,
        );
      }
    });

    await client.connect();
    await client.query('LISTEN app_changes');
    this.client = client;
    this.logger.log('LISTENing on app_changes');
  }
}

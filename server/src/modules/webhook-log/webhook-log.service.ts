import { Injectable, Scope } from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';
import { WebhookDeliveries } from '../../database/entities/webhooks/webhook_deliveries.entity';

/** Ported from src/lib/webhook-log.ts. */
@Injectable({ scope: Scope.REQUEST })
export class WebhookLogService {
  constructor(private readonly tx: TenantTxHost) {}

  async list(
    accountId: string,
    opts: { endpoint?: string; limit?: number } = {},
  ): Promise<WebhookDeliveries[]> {
    return this.tx.manager.find(WebhookDeliveries, {
      where: {
        accountId,
        ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
      },
      order: { createdAt: 'DESC' },
      take: opts.limit ?? 50,
    });
  }
}

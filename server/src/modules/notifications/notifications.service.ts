import { Injectable, Scope } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { TenantTxHost } from '../../common/tenant-tx.host';
import { Notifications } from '../../database/entities/notifications/notifications.entity';

@Injectable({ scope: Scope.REQUEST })
export class NotificationsService {
  constructor(private readonly tx: TenantTxHost) {}

  async list(accountId: string, userId: string, limit = 30) {
    return this.tx.manager.find(Notifications, {
      where: { accountId, userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async unreadCount(accountId: string, userId: string): Promise<number> {
    return this.tx.manager.count(Notifications, {
      where: { accountId, userId, readAt: IsNull() },
    });
  }

  async markRead(accountId: string, userId: string, id: string): Promise<void> {
    await this.tx.manager
      .createQueryBuilder()
      .update(Notifications)
      .set({ readAt: new Date() })
      .where('id = :id AND account_id = :accountId AND user_id = :userId', {
        id,
        accountId,
        userId,
      })
      .execute();
  }

  async markAllRead(accountId: string, userId: string): Promise<void> {
    await this.tx.manager
      .createQueryBuilder()
      .update(Notifications)
      .set({ readAt: new Date() })
      .where(
        'account_id = :accountId AND user_id = :userId AND read_at IS NULL',
        { accountId, userId },
      )
      .execute();
  }
}

import {
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/authenticated-request';
import { NotificationsService } from './notifications.service';

@UseGuards(AccountMemberGuard)
@Controller('accounts/:accountId/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(
    @Param('accountId') accountId: string,
    @CurrentUser() user: RequestUser,
    @Query('limit') limit?: string,
  ) {
    return this.notificationsService.list(
      accountId,
      user.id,
      limit ? Number(limit) : undefined,
    );
  }

  @Get('unread-count')
  async unreadCount(
    @Param('accountId') accountId: string,
    @CurrentUser() user: RequestUser,
  ) {
    const count = await this.notificationsService.unreadCount(
      accountId,
      user.id,
    );
    return { count };
  }

  @Patch(':id/read')
  markRead(
    @Param('accountId') accountId: string,
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.notificationsService.markRead(accountId, user.id, id);
  }

  @Post('read-all')
  markAllRead(
    @Param('accountId') accountId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.notificationsService.markAllRead(accountId, user.id);
  }
}

import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { WebhookLogService } from './webhook-log.service';

@UseGuards(AccountMemberGuard)
@Controller('accounts/:accountId/webhook-deliveries')
export class WebhookLogController {
  constructor(private readonly service: WebhookLogService) {}

  @Get()
  list(
    @Param('accountId') accountId: string,
    @Query('endpoint') endpoint?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list(accountId, {
      endpoint,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}

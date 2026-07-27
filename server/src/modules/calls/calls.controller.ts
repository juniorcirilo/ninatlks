import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { CallsService } from './calls.service';

@UseGuards(AccountMemberGuard)
@Controller('accounts/:accountId/calls')
export class CallsController {
  constructor(private readonly service: CallsService) {}

  @Get()
  list(
    @Param('accountId') accountId: string,
    @Query('direction') direction?: 'inbound' | 'outbound' | 'all',
    @Query('limit') limit?: string,
  ) {
    return this.service.list(accountId, {
      direction,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get(':id')
  async detail(@Param('accountId') accountId: string, @Param('id') id: string) {
    const call = await this.service.detail(accountId, id);
    if (!call) throw new NotFoundException('call not found');
    return call;
  }
}

import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { IntegrationsStatusService } from './integrations-status.service';

@UseGuards(AccountMemberGuard, RolesGuard)
@Roles('admin')
@Controller('accounts/:accountId/integrations-status')
export class IntegrationsStatusController {
  constructor(private readonly service: IntegrationsStatusService) {}

  @Post()
  check(@Param('accountId') accountId: string) {
    return this.service.check(accountId);
  }
}

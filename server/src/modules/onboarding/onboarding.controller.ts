import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OnboardingService } from './onboarding.service';
import { IntegrationsStatusService } from '../integrations-status/integrations-status.service';
import { AdvanceStepDto, GotoStepDto } from './dto/onboarding.dto';

@UseGuards(AccountMemberGuard, RolesGuard)
@Roles('admin')
@Controller('accounts/:accountId/onboarding')
export class OnboardingController {
  constructor(
    private readonly service: OnboardingService,
    private readonly integrationsStatus: IntegrationsStatusService,
  ) {}

  @Get()
  getState(@Param('accountId') accountId: string) {
    return this.service.getState(accountId);
  }

  @Post('advance')
  advance(@Param('accountId') accountId: string, @Body() dto: AdvanceStepDto) {
    return this.service.advanceStep(accountId, dto.step, dto.payload);
  }

  @Post('goto')
  async goto(@Param('accountId') accountId: string, @Body() dto: GotoStepDto) {
    await this.service.gotoStep(accountId, dto.step);
    return { ok: true };
  }

  @Post('skip')
  async skip(@Param('accountId') accountId: string) {
    await this.service.skip(accountId);
    return { ok: true };
  }

  @Post('dismiss-checklist')
  async dismissChecklist(@Param('accountId') accountId: string) {
    await this.service.dismissChecklist(accountId);
    return { ok: true };
  }

  @Post('dismiss')
  async dismiss(@Param('accountId') accountId: string) {
    await this.service.dismiss(accountId);
    return { ok: true };
  }

  @Post('reopen')
  async reopen(@Param('accountId') accountId: string) {
    await this.service.reopen(accountId);
    return { ok: true };
  }

  @Post('health-check')
  async healthCheck(@Param('accountId') accountId: string) {
    const report = await this.integrationsStatus.check(accountId);
    await this.service.recordHealthCheck(accountId, report);
    return report;
  }
}

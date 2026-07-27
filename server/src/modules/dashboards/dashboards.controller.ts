import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { DashboardSdrService } from './dashboard-sdr.service';
import { MissionControlService } from './mission-control.service';
import { AgentAnalyticsService } from './agent-analytics.service';

@UseGuards(AccountMemberGuard)
@Controller('accounts/:accountId/dashboards')
export class DashboardsController {
  constructor(
    private readonly sdr: DashboardSdrService,
    private readonly missionControl: MissionControlService,
    private readonly agentAnalytics: AgentAnalyticsService,
  ) {}

  @Get('sdr-snapshot')
  sdrSnapshot(@Param('accountId') accountId: string) {
    return this.sdr.snapshot(accountId);
  }

  @Get('mission-control')
  missionControlSnapshot(@Param('accountId') accountId: string) {
    return this.missionControl.snapshot(accountId);
  }

  @Get('agent-analytics')
  agentAnalyticsResult(
    @Param('accountId') accountId: string,
    @Query('windowDays') windowDays?: string,
  ) {
    return this.agentAnalytics.get(
      accountId,
      windowDays ? parseInt(windowDays, 10) : undefined,
    );
  }
}

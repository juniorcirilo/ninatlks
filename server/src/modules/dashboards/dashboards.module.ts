import { Module } from '@nestjs/common';
import { DashboardsController } from './dashboards.controller';
import { DashboardSdrService } from './dashboard-sdr.service';
import { MissionControlService } from './mission-control.service';
import { AgentAnalyticsService } from './agent-analytics.service';

@Module({
  controllers: [DashboardsController],
  providers: [
    DashboardSdrService,
    MissionControlService,
    AgentAnalyticsService,
  ],
})
export class DashboardsModule {}

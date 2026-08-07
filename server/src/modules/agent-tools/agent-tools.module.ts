import { Module } from '@nestjs/common';
import { AgentToolsController } from './agent-tools.controller';
import { AgentToolsService } from './agent-tools.service';
import { AgentToolsAuthGuard } from './agent-tools-auth.guard';
import { MeetingNotificationsModule } from '../meeting-notifications/meeting-notifications.module';

@Module({
  imports: [MeetingNotificationsModule],
  controllers: [AgentToolsController],
  providers: [AgentToolsService, AgentToolsAuthGuard],
})
export class AgentToolsModule {}

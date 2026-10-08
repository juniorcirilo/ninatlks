import { Module } from '@nestjs/common';
import { IntegrationsStatusController } from './integrations-status.controller';
import { IntegrationsStatusService } from './integrations-status.service';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { AiAgentModule } from '../ai-agent/ai-agent.module';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';

@Module({
  imports: [GoogleCalendarModule, WhatsAppModule, AiAgentModule],
  controllers: [IntegrationsStatusController],
  providers: [IntegrationsStatusService],
  exports: [IntegrationsStatusService],
})
export class IntegrationsStatusModule {}

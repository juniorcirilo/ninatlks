import { Module } from '@nestjs/common';
import { IntegrationsStatusController } from './integrations-status.controller';
import { IntegrationsStatusService } from './integrations-status.service';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';

@Module({
  imports: [GoogleCalendarModule],
  controllers: [IntegrationsStatusController],
  providers: [IntegrationsStatusService],
  exports: [IntegrationsStatusService],
})
export class IntegrationsStatusModule {}

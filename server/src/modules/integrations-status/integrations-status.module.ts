import { Module } from '@nestjs/common';
import { IntegrationsStatusController } from './integrations-status.controller';
import { IntegrationsStatusService } from './integrations-status.service';

@Module({
  controllers: [IntegrationsStatusController],
  providers: [IntegrationsStatusService],
  exports: [IntegrationsStatusService],
})
export class IntegrationsStatusModule {}

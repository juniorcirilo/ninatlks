import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { WebhookEndpointsModule } from '../webhook-endpoints/webhook-endpoints.module';
import { MeetingNotificationsService } from './meeting-notifications.service';

@Module({
  imports: [EmailModule, WebhookEndpointsModule],
  providers: [MeetingNotificationsService],
  exports: [MeetingNotificationsService],
})
export class MeetingNotificationsModule {}

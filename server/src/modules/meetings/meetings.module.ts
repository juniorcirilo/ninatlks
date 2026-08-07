import { Module } from '@nestjs/common';
import {
  MeetingsController,
  AvailabilityController,
  DoctorsController,
} from './meetings.controller';
import { MeetingsService } from './meetings.service';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';
import { MeetingNotificationsModule } from '../meeting-notifications/meeting-notifications.module';

@Module({
  imports: [GoogleCalendarModule, MeetingNotificationsModule],
  controllers: [MeetingsController, AvailabilityController, DoctorsController],
  providers: [MeetingsService],
})
export class MeetingsModule {}

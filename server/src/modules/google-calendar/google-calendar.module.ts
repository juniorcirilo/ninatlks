import { Module } from '@nestjs/common';
import {
  GoogleCalendarController,
  GoogleCalendarCallbackController,
} from './google-calendar.controller';
import { GoogleCalendarService } from './google-calendar.service';

@Module({
  controllers: [GoogleCalendarController, GoogleCalendarCallbackController],
  providers: [GoogleCalendarService],
  exports: [GoogleCalendarService],
})
export class GoogleCalendarModule {}

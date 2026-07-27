import { Module } from '@nestjs/common';
import {
  MeetingsController,
  AvailabilityController,
  DoctorsController,
} from './meetings.controller';
import { MeetingsService } from './meetings.service';

@Module({
  controllers: [MeetingsController, AvailabilityController, DoctorsController],
  providers: [MeetingsService],
})
export class MeetingsModule {}

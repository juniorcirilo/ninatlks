import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { MeetingsService } from './meetings.service';
import { SetOutcomeDto } from './dto/set-outcome.dto';
import { UpsertDoctorDto } from './dto/upsert-doctor.dto';
import {
  SetDoctorAvailabilityDto,
  SetUserAvailabilityDto,
} from './dto/set-availability.dto';

@UseGuards(AccountMemberGuard)
@Controller('accounts/:accountId/meetings')
export class MeetingsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  @Get()
  list(
    @Param('accountId') accountId: string,
    @Query('start') start: string,
    @Query('end') end: string,
  ) {
    return this.meetingsService.listMeetings(accountId, start, end);
  }

  @Patch(':id/outcome')
  setOutcome(
    @Param('accountId') _accountId: string,
    @Param('id') id: string,
    @Body() dto: SetOutcomeDto,
  ) {
    return this.meetingsService.setOutcome(
      id,
      dto.status,
      dto.notes,
      dto.cancellationReason,
    );
  }
}

@UseGuards(AccountMemberGuard)
@Controller('accounts/:accountId/availability')
export class AvailabilityController {
  constructor(private readonly meetingsService: MeetingsService) {}

  @Get()
  get(@Param('accountId') accountId: string) {
    return this.meetingsService.getWeeklyAvailability(accountId);
  }

  @Put()
  set(
    @Param('accountId') accountId: string,
    @Body() dto: SetUserAvailabilityDto,
  ) {
    return this.meetingsService.setWeeklyAvailability(
      accountId,
      dto.userId,
      dto.slots,
    );
  }
}

@UseGuards(AccountMemberGuard)
@Controller('accounts/:accountId/doctors')
export class DoctorsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  @Get()
  list(@Param('accountId') accountId: string) {
    return this.meetingsService.listDoctors(accountId);
  }

  @Post()
  create(@Param('accountId') accountId: string, @Body() dto: UpsertDoctorDto) {
    return this.meetingsService.createDoctor(accountId, dto);
  }

  @Patch(':id')
  update(
    @Param('accountId') accountId: string,
    @Param('id') id: string,
    @Body() dto: UpsertDoctorDto,
  ) {
    return this.meetingsService.updateDoctor(accountId, id, dto);
  }

  @Delete(':id')
  delete(@Param('accountId') accountId: string, @Param('id') id: string) {
    return this.meetingsService.deleteDoctor(accountId, id);
  }

  @Put(':id/availability')
  setAvailability(
    @Param('accountId') accountId: string,
    @Param('id') id: string,
    @Body() dto: SetDoctorAvailabilityDto,
  ) {
    return this.meetingsService.setDoctorAvailability(accountId, id, dto.slots);
  }
}

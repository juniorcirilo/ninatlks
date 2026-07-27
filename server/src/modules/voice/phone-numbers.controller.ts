import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PhoneNumbersService } from './phone-numbers.service';
import { ElevenLabsPhoneService } from './elevenlabs-phone.service';
import {
  CreatePhoneNumberDto,
  UpdatePhoneNumberDto,
} from './dto/phone-number.dto';

@UseGuards(AccountMemberGuard, RolesGuard)
@Controller('accounts/:accountId/phone-numbers')
export class PhoneNumbersController {
  constructor(
    private readonly service: PhoneNumbersService,
    private readonly elPhoneService: ElevenLabsPhoneService,
  ) {}

  @Get()
  list(@Param('accountId') accountId: string) {
    return this.service.list(accountId);
  }

  @Roles('admin')
  @Post()
  create(
    @Param('accountId') accountId: string,
    @Body() dto: CreatePhoneNumberDto,
  ) {
    return this.service.create(accountId, dto);
  }

  @Roles('admin')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePhoneNumberDto) {
    return this.service.update(id, dto);
  }

  @Roles('admin')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Roles('admin')
  @Post(':id/activate-elevenlabs')
  activateElevenLabs(
    @Param('accountId') accountId: string,
    @Param('id') id: string,
  ) {
    return this.elPhoneService.register(accountId, id);
  }
}

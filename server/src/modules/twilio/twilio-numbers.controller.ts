import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TwilioPhoneNumbersService } from './twilio-phone-numbers.service';
import { SearchNumbersDto } from './dto/search-numbers.dto';
import { BuyNumberDto, ImportNumberDto } from './dto/buy-number.dto';

@UseGuards(AccountMemberGuard, RolesGuard)
@Controller('accounts/:accountId/twilio/numbers')
export class TwilioNumbersController {
  constructor(private readonly service: TwilioPhoneNumbersService) {}

  @Get('owned')
  @Roles('admin')
  owned(@Param('accountId') accountId: string) {
    return this.service.listOwned(accountId);
  }

  @Get('search')
  search(
    @Param('accountId') accountId: string,
    @Query() dto: SearchNumbersDto,
  ) {
    return this.service.search(accountId, {
      countryCode: (dto.countryCode ?? 'BR').toUpperCase(),
      type: dto.type ?? 'Local',
      areaCode: dto.areaCode,
      contains: dto.contains,
      voiceEnabled: dto.voice ?? true,
      smsEnabled: dto.sms ?? true,
      mmsEnabled: dto.mms,
      limit: dto.limit,
    });
  }

  @Post('buy')
  @Roles('admin')
  buy(@Param('accountId') accountId: string, @Body() dto: BuyNumberDto) {
    return this.service.buy(accountId, dto);
  }

  @Post('import')
  @Roles('admin')
  import(@Param('accountId') accountId: string, @Body() dto: ImportNumberDto) {
    return this.service.importExisting(accountId, dto);
  }
}

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/authenticated-request';
import { AccountSettingsService } from './account-settings.service';
import { UpdateAccountDto } from './dto/update-account.dto';
import { DialingSettingsDto } from './dto/dialing-settings.dto';
import { SetAvailabilityDto } from './dto/set-availability.dto';

@UseGuards(AccountMemberGuard, RolesGuard)
@Controller('accounts/:accountId')
export class AccountSettingsController {
  constructor(
    private readonly accountSettingsService: AccountSettingsService,
  ) {}

  @Get()
  get(@Param('accountId') accountId: string) {
    return this.accountSettingsService.fetchAccount(accountId);
  }

  @Patch()
  @Roles('admin')
  update(@Param('accountId') accountId: string, @Body() dto: UpdateAccountDto) {
    return this.accountSettingsService.updateAccountSettings(accountId, dto);
  }

  @Get('dialing-settings')
  getDialing(@Param('accountId') accountId: string) {
    return this.accountSettingsService.fetchDialingSettings(accountId);
  }

  @Put('dialing-settings')
  @Roles('admin')
  putDialing(
    @Param('accountId') accountId: string,
    @Body() dto: DialingSettingsDto,
  ) {
    return this.accountSettingsService.updateDialingSettings(accountId, dto);
  }

  @Post('webhook-secret')
  @Roles('admin')
  ensureWebhookSecret(@Param('accountId') accountId: string) {
    return this.accountSettingsService.ensureWebhookSecret(accountId);
  }

  @Get('my-availability')
  getMyAvailability(
    @Param('accountId') accountId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.accountSettingsService.getMyAvailability(accountId, user.id);
  }

  @Put('my-availability')
  setMyAvailability(
    @Param('accountId') accountId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: SetAvailabilityDto,
  ) {
    return this.accountSettingsService.setMyAvailability(
      accountId,
      user.id,
      dto.availability,
    );
  }

  @Get('inboxes')
  listInboxes(@Param('accountId') accountId: string) {
    return this.accountSettingsService.listInboxes(accountId);
  }
}

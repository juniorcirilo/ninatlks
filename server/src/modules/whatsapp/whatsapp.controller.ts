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
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppDirectoryService } from './whatsapp-directory.service';
import {
  PairingCodeDto,
  ProvisionWhatsAppDto,
  UpdateWhatsAppChannelDto,
} from './dto/whatsapp.dto';

@UseGuards(AccountMemberGuard, RolesGuard)
@Controller('accounts/:accountId/whatsapp')
export class WhatsAppController {
  constructor(
    private readonly service: WhatsAppService,
    private readonly directory: WhatsAppDirectoryService,
  ) {}

  @Get()
  list(@Param('accountId') accountId: string) {
    return this.service.listChannels(accountId);
  }

  @Get('sessions')
  sessions(@Param('accountId') accountId: string) {
    return this.service.listSessions(accountId);
  }

  @Get('directory/contacts')
  contacts(@Param('accountId') accountId: string) {
    return this.directory.contacts(accountId);
  }

  @Get('directory/groups')
  groups(@Param('accountId') accountId: string) {
    return this.directory.groups(accountId);
  }

  @Post('channels')
  @Roles('admin')
  provision(
    @Param('accountId') accountId: string,
    @Body() dto: ProvisionWhatsAppDto,
  ) {
    return this.service.provision(accountId, dto);
  }

  @Get('channels/:channelId/qrcode')
  @Roles('admin')
  qrcode(
    @Param('accountId') accountId: string,
    @Param('channelId') channelId: string,
  ) {
    return this.service.getQrcode(accountId, channelId);
  }

  @Get('channels/:channelId/status')
  @Roles('admin')
  status(
    @Param('accountId') accountId: string,
    @Param('channelId') channelId: string,
  ) {
    return this.service.getStatus(accountId, channelId);
  }

  @Post('channels/:channelId/pairing-code')
  @Roles('admin')
  pairingCode(
    @Param('accountId') accountId: string,
    @Param('channelId') channelId: string,
    @Body() dto: PairingCodeDto,
  ) {
    return this.service.requestPairingCode(accountId, channelId, dto.phone);
  }

  @Post('channels/:channelId/restart')
  @Roles('admin')
  restart(
    @Param('accountId') accountId: string,
    @Param('channelId') channelId: string,
  ) {
    return this.service.restart(accountId, channelId);
  }

  /** Limpa o cache do Baileys (contatos/grupos/LID) e ressincroniza; mantém o login. */
  @Post('channels/:channelId/resync')
  @Roles('admin')
  resync(
    @Param('accountId') accountId: string,
    @Param('channelId') channelId: string,
  ) {
    return this.service.resync(accountId, channelId);
  }

  @Post('channels/:channelId/logout')
  @Roles('admin')
  logout(
    @Param('accountId') accountId: string,
    @Param('channelId') channelId: string,
  ) {
    return this.service.logout(accountId, channelId);
  }

  @Patch('channels/:channelId')
  @Roles('admin')
  update(
    @Param('accountId') accountId: string,
    @Param('channelId') channelId: string,
    @Body() dto: UpdateWhatsAppChannelDto,
  ) {
    return this.service.updateChannel(accountId, channelId, dto);
  }

  @Delete('channels/:channelId')
  @Roles('admin')
  remove(
    @Param('accountId') accountId: string,
    @Param('channelId') channelId: string,
  ) {
    return this.service.deleteChannel(accountId, channelId);
  }
}

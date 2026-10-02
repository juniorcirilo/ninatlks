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
import { EvolutionService } from './evolution.service';
import {
  TestEvolutionDto,
  ProvisionEvolutionDto,
  UpdateEvolutionChannelDto,
} from './dto/evolution.dto';

@UseGuards(AccountMemberGuard, RolesGuard)
@Controller('accounts/:accountId/evolution')
export class EvolutionController {
  constructor(private readonly evolutionService: EvolutionService) {}

  @Get()
  list(@Param('accountId') accountId: string) {
    return this.evolutionService.listChannels(accountId);
  }

  @Get('sessions')
  sessions(@Param('accountId') accountId: string) {
    return this.evolutionService.listSessions(accountId);
  }

  @Post('test')
  @Roles('admin')
  test(@Param('accountId') _accountId: string, @Body() dto: TestEvolutionDto) {
    return this.evolutionService.test(dto.evolutionUrl, dto.evolutionApiKey);
  }

  @Post('provision')
  @Roles('admin')
  provision(
    @Param('accountId') accountId: string,
    @Body() dto: ProvisionEvolutionDto,
  ) {
    return this.evolutionService.provision(accountId, dto);
  }

  @Get('channels/:channelId/qrcode')
  @Roles('admin')
  qrcode(
    @Param('accountId') accountId: string,
    @Param('channelId') channelId: string,
  ) {
    return this.evolutionService.getQrcode(accountId, channelId);
  }

  @Get('channels/:channelId/status')
  @Roles('admin')
  status(
    @Param('accountId') accountId: string,
    @Param('channelId') channelId: string,
  ) {
    return this.evolutionService.getStatus(accountId, channelId);
  }

  @Post('channels/:channelId/restart')
  @Roles('admin')
  restart(
    @Param('accountId') accountId: string,
    @Param('channelId') channelId: string,
  ) {
    return this.evolutionService.restart(accountId, channelId);
  }

  @Post('channels/:channelId/logout')
  @Roles('admin')
  logout(
    @Param('accountId') accountId: string,
    @Param('channelId') channelId: string,
  ) {
    return this.evolutionService.logout(accountId, channelId);
  }

  @Patch('channels/:channelId')
  @Roles('admin')
  update(
    @Param('accountId') accountId: string,
    @Param('channelId') channelId: string,
    @Body() dto: UpdateEvolutionChannelDto,
  ) {
    return this.evolutionService.updateChannel(accountId, channelId, dto);
  }

  @Delete('channels/:channelId')
  @Roles('admin')
  remove(
    @Param('accountId') accountId: string,
    @Param('channelId') channelId: string,
  ) {
    return this.evolutionService.deleteChannel(accountId, channelId);
  }
}

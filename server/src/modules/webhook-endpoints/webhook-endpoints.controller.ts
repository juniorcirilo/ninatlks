import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/authenticated-request';
import { WebhookEndpointsService } from './webhook-endpoints.service';
import { CreateWebhookEndpointDto } from './dto/create-webhook-endpoint.dto';
import { UpdateWebhookEndpointDto } from './dto/update-webhook-endpoint.dto';

/**
 * Destinos de webhook de envio, administrados pela tela de Configurações.
 * Só admin: cada linha carrega um segredo e diz para onde sai dado de cliente.
 */
@UseGuards(AccountMemberGuard, RolesGuard)
@Roles('admin')
@Controller('accounts/:accountId/webhook-endpoints')
export class WebhookEndpointsController {
  constructor(private readonly endpoints: WebhookEndpointsService) {}

  @Get()
  list(
    @Param('accountId') accountId: string,
    @Query('agentId') agentId?: string,
  ) {
    return this.endpoints.list(accountId, agentId);
  }

  @Post()
  create(
    @Param('accountId') accountId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateWebhookEndpointDto,
  ) {
    return this.endpoints.create(accountId, user.id, dto);
  }

  @Patch(':id')
  update(
    @Param('accountId') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWebhookEndpointDto,
  ) {
    return this.endpoints.update(accountId, id, dto);
  }

  @Post(':id/rotate-secret')
  rotateSecret(
    @Param('accountId') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.endpoints.rotateSecret(accountId, id);
  }

  @Delete(':id')
  remove(
    @Param('accountId') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.endpoints.remove(accountId, id);
  }
}

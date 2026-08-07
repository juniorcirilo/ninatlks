import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/authenticated-request';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

/**
 * Administração das chaves de integração pela UI. Só admin: é a credencial
 * que dá acesso de escrita à base de contatos da conta inteira, sem sessão e
 * sem passar por tela nenhuma.
 */
@UseGuards(AccountMemberGuard, RolesGuard)
@Roles('admin')
@Controller('accounts/:accountId/api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  list(@Param('accountId') accountId: string) {
    return this.apiKeys.list(accountId);
  }

  /** A resposta traz `token` em claro — é a única vez que ele existe fora do hash. */
  @Post()
  create(
    @Param('accountId') accountId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.apiKeys.create(accountId, user.id, dto);
  }

  @Delete(':id')
  revoke(@Param('accountId') accountId: string, @Param('id') id: string) {
    return this.apiKeys.revoke(accountId, id);
  }
}

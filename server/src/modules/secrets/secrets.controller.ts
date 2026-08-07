import {
  BadRequestException,
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
import { SecretsService } from './secrets.service';
import { SetSecretDto } from './dto/set-secret.dto';
import { n8nLockedByEnv } from '../n8n/n8n-client.service';

@UseGuards(AccountMemberGuard, RolesGuard)
@Controller('accounts/:accountId/secrets')
export class SecretsController {
  constructor(private readonly secretsService: SecretsService) {}

  @Get()
  @Roles('admin')
  list(@Param('accountId') accountId: string) {
    return this.secretsService.list(accountId);
  }

  @Post()
  @Roles('admin')
  set(@Param('accountId') accountId: string, @Body() dto: SetSecretDto) {
    // n8n é a única credencial deste endpoint que pode vir fixada por
    // variável de ambiente do servidor (N8N_URL/N8N_API_KEY) em vez de por
    // conta. Quando está fixada, a leitura (N8nClientService.credentials)
    // ignora o vault de qualquer forma — mas aceitar a escrita mesmo assim
    // daria a falsa impressão de "salvei, então é isso que vale". Recusa alto
    // em vez de aceitar e ignorar em silêncio.
    if (dto.provider === 'n8n' && n8nLockedByEnv()) {
      throw new BadRequestException(
        'A integração n8n está fixada por variável de ambiente do servidor (N8N_URL/N8N_API_KEY) nesta instalação e não pode ser alterada por aqui.',
      );
    }
    return this.secretsService.set(
      accountId,
      dto.provider,
      dto.keyName,
      dto.value,
      dto.metadata,
    );
  }

  @Delete(':provider/:keyName')
  @Roles('admin')
  delete(
    @Param('accountId') accountId: string,
    @Param('provider') provider: string,
    @Param('keyName') keyName: string,
  ) {
    if (provider === 'n8n' && n8nLockedByEnv()) {
      throw new BadRequestException(
        'A integração n8n está fixada por variável de ambiente do servidor (N8N_URL/N8N_API_KEY) nesta instalação e não pode ser alterada por aqui.',
      );
    }
    return this.secretsService.delete(accountId, provider, keyName);
  }
}

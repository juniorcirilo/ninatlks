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
import { SecretsService } from './secrets.service';
import { SetSecretDto } from './dto/set-secret.dto';

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
    return this.secretsService.delete(accountId, provider, keyName);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { PersonasService } from './personas.service';
import { DeployPersonaDto } from './dto/deploy-persona.dto';

@UseGuards(AccountMemberGuard)
@Controller('accounts/:accountId/persona-deployments')
export class PersonaDeploymentsController {
  constructor(private readonly personasService: PersonasService) {}

  @Get('active-for-inbox')
  findActiveForInbox(
    @Param('accountId') accountId: string,
    @Query('inboxId') inboxId: string,
  ) {
    return this.personasService.findActiveDeploymentForInbox(
      accountId,
      inboxId,
    );
  }

  @Post()
  deploy(@Param('accountId') accountId: string, @Body() dto: DeployPersonaDto) {
    return this.personasService.deploy({ accountId, ...dto });
  }

  @Delete(':id')
  remove(@Param('accountId') accountId: string, @Param('id') id: string) {
    return this.personasService.removeDeployment(accountId, id);
  }
}

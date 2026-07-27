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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/authenticated-request';
import { PersonasService } from './personas.service';
import { CreatePersonaDto } from './dto/create-persona.dto';
import { UpdatePersonaDto } from './dto/update-persona.dto';

@UseGuards(AccountMemberGuard)
@Controller('accounts/:accountId/personas')
export class PersonasController {
  constructor(private readonly personasService: PersonasService) {}

  @Get()
  list(@Param('accountId') accountId: string) {
    return this.personasService.list(accountId);
  }

  @Post()
  create(
    @Param('accountId') accountId: string,
    @Body() dto: CreatePersonaDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.personasService.create({
      accountId,
      name: dto.name,
      description: dto.description,
      sourceUserId: dto.sourceUserId ?? user.id,
    });
  }

  @Patch(':id')
  update(
    @Param('accountId') accountId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePersonaDto,
  ) {
    return this.personasService.update(accountId, id, dto);
  }

  @Delete(':id')
  remove(@Param('accountId') accountId: string, @Param('id') id: string) {
    return this.personasService.remove(accountId, id);
  }

  @Get(':id/deployments')
  listDeployments(
    @Param('accountId') accountId: string,
    @Param('id') id: string,
  ) {
    return this.personasService.listDeployments(accountId, id);
  }

  @Post(':id/distill')
  distill(@Param('accountId') accountId: string, @Param('id') id: string) {
    return this.personasService.distill(accountId, id);
  }

  @Post(':id/suggest-reply')
  suggestReply(
    @Param('accountId') accountId: string,
    @Param('id') id: string,
    @Body() body: { conversationId: string },
  ) {
    return this.personasService.suggestReply(accountId, id, body.conversationId);
  }

  @Post(':id/generate-prompt')
  generatePrompt(
    @Param('accountId') accountId: string,
    @Param('id') id: string,
    @Body() body: { description: string; existingPrompt?: string; refine?: boolean },
  ) {
    return this.personasService.generatePrompt(accountId, id, body);
  }
}

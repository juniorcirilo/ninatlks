import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { PipelineService } from './pipeline.service';
import { MoveLeadDto } from './dto/move-lead.dto';

@UseGuards(AccountMemberGuard)
@Controller('accounts/:accountId/pipeline')
export class PipelineController {
  constructor(private readonly pipelineService: PipelineService) {}

  @Get()
  get(@Param('accountId') accountId: string) {
    return this.pipelineService.get(accountId);
  }

  @Post('leads/:contactId/move')
  move(
    @Param('accountId') _accountId: string,
    @Param('contactId') contactId: string,
    @Body() dto: MoveLeadDto,
  ) {
    return this.pipelineService.moveToStage(contactId, dto.stageId, dto.reason);
  }
}

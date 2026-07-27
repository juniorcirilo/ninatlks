import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/authenticated-request';
import { VoiceOutboundService } from './voice-outbound.service';
import { VoiceElOutboundService } from './voice-el-outbound.service';
import { VoiceCallsService } from './voice-calls.service';
import { PhoneNumbersService } from './phone-numbers.service';
import { PlaceCallDto } from './dto/place-call.dto';
import { CallSummaryService } from './call-summary.service';
import { CallTranscriptionService } from './call-transcription.service';
import { CallOpsService } from './call-ops.service';
import { GenerateSummaryDto } from './dto/generate-summary.dto';

@UseGuards(AccountMemberGuard, RolesGuard)
@Controller('accounts/:accountId/voice/calls')
export class VoiceOutboundController {
  constructor(
    private readonly service: VoiceOutboundService,
    private readonly elService: VoiceElOutboundService,
    private readonly callsService: VoiceCallsService,
    private readonly phoneNumbers: PhoneNumbersService,
    private readonly summaryService: CallSummaryService,
    private readonly transcriptionService: CallTranscriptionService,
    private readonly callOps: CallOpsService,
  ) {}

  @Get()
  list(@Param('accountId') accountId: string, @Query('limit') limit?: string) {
    return this.callsService.list(
      accountId,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Get(':id')
  async get(@Param('accountId') accountId: string, @Param('id') id: string) {
    const call = await this.callsService.get(accountId, id);
    if (!call) throw new NotFoundException('call not found');
    return call;
  }

  @Post()
  async placeCall(
    @Param('accountId') accountId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: PlaceCallDto,
  ) {
    const useElevenLabs = await this.phoneNumbers.hasElevenLabsRouting(
      accountId,
      dto.fromNumberId,
    );
    if (useElevenLabs) {
      return this.elService.placeCall(accountId, user.id, dto);
    }
    return this.service.placeCall(accountId, user.id, dto);
  }

  @Post(':id/summary')
  async generateSummary(
    @Param('accountId') accountId: string,
    @Param('id') id: string,
    @Body() dto: GenerateSummaryDto,
    @Res() res: Response,
  ): Promise<void> {
    const call = await this.callsService.get(accountId, id);
    if (!call) throw new NotFoundException('call not found');
    const { status, body } = await this.summaryService.generate(
      id,
      dto.force ?? false,
    );
    res.status(status).json(body);
  }

  @Post(':id/transcribe')
  async retryTranscription(
    @Param('accountId') accountId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const call = await this.callsService.get(accountId, id);
    if (!call) throw new NotFoundException('call not found');
    const { status, body } =
      await this.transcriptionService.transcribeVoice(id);
    res.status(status).json(body);
  }

  @Post(':id/cancel')
  cancelCall(
    @Param('accountId') accountId: string,
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.callOps.cancel(accountId, { voiceCallId: id }, user.id);
  }

  @Post(':id/reclassify')
  @Roles('admin')
  reclassify(
    @Param('accountId') accountId: string,
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.callOps.reclassify(accountId, id, user.id);
  }
}

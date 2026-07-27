import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ElevenLabsService } from './elevenlabs.service';
import { ElevenLabsAgentService } from './elevenlabs-agent.service';
import {
  PreviewVoiceDto,
  VoiceSettingsDto,
  AgentSyncDto,
  KbAddDto,
  CallAudioDto,
} from './dto/elevenlabs.dto';

@UseGuards(AccountMemberGuard, RolesGuard)
@Controller('accounts/:accountId/elevenlabs')
export class ElevenLabsController {
  constructor(
    private readonly elevenLabsService: ElevenLabsService,
    private readonly agentService: ElevenLabsAgentService,
  ) {}

  @Get('voices')
  list(
    @Param('accountId') accountId: string,
    @Query('include') include?: string,
  ) {
    return this.elevenLabsService.listVoicesAndSubscription(
      accountId,
      include ?? 'voices,subscription',
    );
  }

  @Patch('voices/:voiceId/settings')
  updateSettings(
    @Param('accountId') accountId: string,
    @Param('voiceId') voiceId: string,
    @Body() dto: VoiceSettingsDto,
  ) {
    return this.elevenLabsService.updateVoiceSettings(accountId, voiceId, dto);
  }

  @Delete('voices/:voiceId')
  @Roles('admin')
  remove(
    @Param('accountId') accountId: string,
    @Param('voiceId') voiceId: string,
  ) {
    return this.elevenLabsService.deleteVoice(accountId, voiceId);
  }

  @Post('preview')
  async preview(
    @Param('accountId') accountId: string,
    @Body() dto: PreviewVoiceDto,
    @Res() res: Response,
  ) {
    const buf = await this.elevenLabsService.preview(accountId, dto);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  }

  @Post('agent-sync')
  syncAgent(@Param('accountId') accountId: string, @Body() dto: AgentSyncDto) {
    return this.agentService.syncPersona(accountId, dto.personaId);
  }

  @Get('agent-info/:agentId')
  getAgentInfo(
    @Param('accountId') accountId: string,
    @Param('agentId') agentId: string,
  ) {
    return this.agentService.getAgentInfo(accountId, agentId);
  }

  @Post('kb-add')
  addKnowledgeBase(
    @Param('accountId') accountId: string,
    @Body() dto: KbAddDto,
  ) {
    return this.agentService.addKnowledgeBaseDocument(accountId, dto);
  }

  @Post('call-audio')
  async callAudio(
    @Param('accountId') accountId: string,
    @Body() dto: CallAudioDto,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.agentService.getCallAudio(
      accountId,
      dto.voiceCallId,
    );
    if (result.kind === 'redirect') {
      res
        .status(200)
        .json({ ok: true, audio_url: result.url, source: 'twilio' });
      return;
    }
    if (result.kind === 'stream') {
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.status(200).send(result.body);
      return;
    }
    res.status(200).json({
      ok: false,
      fallback: true,
      error: result.error,
      status: result.status,
      detail: result.detail,
    });
  }
}

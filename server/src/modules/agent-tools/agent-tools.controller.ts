import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { AgentToolsAuthGuard } from './agent-tools-auth.guard';
import { AgentToolsService } from './agent-tools.service';
import {
  ConfirmMeetingDto,
  GetAvailabilityDto,
  QualifyLeadDto,
  RescheduleMeetingDto,
  ScheduleMeetingDto,
} from './dto/agent-tools.dto';

/**
 * Ported from the supabase/functions/agent-tool-* edge functions — function-calling
 * tools the ElevenLabs agent invokes DURING a live call. No user session:
 * auth is the shared secret checked by AgentToolsAuthGuard, so every route
 * opts out of the global SessionAuthGuard via @Public().
 */
@Controller('agent-tools')
@UseGuards(AgentToolsAuthGuard)
export class AgentToolsController {
  constructor(private readonly agentTools: AgentToolsService) {}

  @Public()
  @Post('confirm-meeting')
  @HttpCode(200)
  async confirmMeeting(
    @Body() dto: ConfirmMeetingDto,
    @Res() res: Response,
  ): Promise<void> {
    const { status, body } = await this.agentTools.confirmMeeting(dto);
    res.status(status).json(body);
  }

  @Public()
  @Post('get-availability')
  @HttpCode(200)
  async getAvailability(
    @Body() dto: GetAvailabilityDto,
    @Res() res: Response,
  ): Promise<void> {
    const { status, body } = await this.agentTools.getAvailability(dto);
    res.status(status).json(body);
  }

  @Public()
  @Post('qualify-lead')
  @HttpCode(200)
  async qualifyLead(
    @Body() dto: QualifyLeadDto,
    @Headers('x-conversation-id') conversationIdHeader: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const { status, body } = await this.agentTools.qualifyLead(
      dto,
      conversationIdHeader ?? null,
    );
    res.status(status).json(body);
  }

  @Public()
  @Post('reschedule-meeting')
  @HttpCode(200)
  async rescheduleMeeting(
    @Body() dto: RescheduleMeetingDto,
    @Res() res: Response,
  ): Promise<void> {
    const { status, body } = await this.agentTools.rescheduleMeeting(dto);
    res.status(status).json(body);
  }

  @Public()
  @Post('schedule-meeting')
  @HttpCode(200)
  async scheduleMeeting(
    @Body() dto: ScheduleMeetingDto,
    @Res() res: Response,
  ): Promise<void> {
    const { status, body } = await this.agentTools.scheduleMeeting(dto);
    res.status(status).json(body);
  }
}

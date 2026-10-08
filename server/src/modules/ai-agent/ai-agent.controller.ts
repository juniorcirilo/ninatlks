import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AiAgentService } from './ai-agent.service';
import { sanitizeForUi, brand } from './brand';
import type { BridgeEvent } from './opencode-bridge.service';
import {
  CreateToolDto,
  GenerateSkillDto,
  ProbeDto,
  SaveConnectionDto,
  SkillDto,
  UpdateSettingsDto,
  UpdateSkillDto,
  UpdateToolDto,
} from './dto/ai-agent.dto';

@UseGuards(AccountMemberGuard, RolesGuard)
@Controller('accounts/:accountId/ai-agent')
export class AiAgentController {
  private readonly logger = new Logger(AiAgentController.name);

  constructor(private readonly service: AiAgentService) {}

  @Get()
  overview(@Param('accountId') accountId: string) {
    return this.service.overview(accountId);
  }

  @Get('usage')
  usage(@Param('accountId') accountId: string, @Query('days') days?: string) {
    return this.service.usageSummary(accountId, days ? Number(days) : 30);
  }

  @Patch('settings')
  @Roles('admin')
  settings(
    @Param('accountId') accountId: string,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.service.updateSettings(accountId, dto);
  }

  @Put('connection')
  @Roles('admin')
  saveConnection(
    @Param('accountId') accountId: string,
    @Body() dto: SaveConnectionDto,
  ) {
    return this.service.saveConnection(accountId, dto);
  }

  @Delete('connection')
  @Roles('admin')
  removeConnection(@Param('accountId') accountId: string) {
    return this.service.removeConnection(accountId);
  }

  @Post('connection/models')
  @Roles('admin')
  models(@Param('accountId') accountId: string, @Body() dto: ProbeDto) {
    return this.service.models(accountId, dto);
  }

  @Post('connection/test')
  @Roles('admin')
  test(@Param('accountId') accountId: string, @Body() dto: ProbeDto) {
    return this.service.test(accountId, dto);
  }

  @Post('tools')
  @Roles('admin')
  createTool(
    @Param('accountId') accountId: string,
    @Body() dto: CreateToolDto,
  ) {
    return this.service.createTool(accountId, dto);
  }

  @Patch('tools/:toolId')
  @Roles('admin')
  updateTool(
    @Param('accountId') accountId: string,
    @Param('toolId', ParseUUIDPipe) toolId: string,
    @Body() dto: UpdateToolDto,
  ) {
    return this.service.updateTool(accountId, toolId, dto);
  }

  @Delete('tools/:toolId')
  @Roles('admin')
  deleteTool(
    @Param('accountId') accountId: string,
    @Param('toolId', ParseUUIDPipe) toolId: string,
  ) {
    return this.service.deleteTool(accountId, toolId);
  }

  @Post('connections/:type/test')
  @Roles('admin')
  testConnection(
    @Param('accountId') accountId: string,
    @Param('type') type: string,
  ) {
    return this.service.testDbConnection(accountId, type);
  }

  @Post('skills/generate')
  @Roles('admin')
  generateSkill(
    @Param('accountId') accountId: string,
    @Body() dto: GenerateSkillDto,
  ) {
    return this.service.generateSkill(accountId, dto);
  }

  /**
   * Mesma geração, mas em tempo real (Server-Sent Events): cada evento do
   * motor (raciocínio, uso de ferramentas, trechos de texto, uso de tokens)
   * é repassado assim que acontece, para o painel "Gerando skill…" na tela.
   * Resposta manual (sem o pipeline normal do Nest) para poder ir enviando
   * eventos antes da geração terminar.
   */
  @Post('skills/generate/stream')
  @Roles('admin')
  async generateSkillStream(
    @Param('accountId') accountId: string,
    @Body() dto: GenerateSkillDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const reqId = Math.random().toString(36).slice(2, 8);
    this.logger.log(`[${reqId}] generate-skill start account=${accountId}`);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // Alguns proxies só começam a repassar bytes depois do 1º flush; força um
    // agora para o cliente saber de imediato que a conexão está de pé.
    res.flushHeaders?.();
    const send = (ev: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(sanitizeForUi(ev))}\n\n`);
    };
    send({ type: 'connected' });
    const heartbeat = setInterval(() => res.write(':\n\n'), 15_000);
    // Cliente fechou a aba/o diálogo: cancela o processo em vez de deixá-lo
    // terminando sozinho (e segurando a transação da conta aberta).
    const ctrl = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        this.logger.warn(`[${reqId}] cliente desconectou — cancelando`);
        ctrl.abort();
      }
    });
    try {
      const skill = await this.service.generateSkill(
        accountId,
        dto,
        (ev: BridgeEvent) => {
          if (ev.type === 'model_start' || ev.type === 'model_failed')
            this.logger.log(`[${reqId}] ${JSON.stringify(ev)}`);
          send(ev);
        },
        ctrl.signal,
      );
      this.logger.log(`[${reqId}] generate-skill done slug=${skill.slug}`);
      send({ type: 'done', skill });
    } catch (err) {
      this.logger.warn(
        `[${reqId}] generate-skill failed: ${(err as Error).message}`,
      );
      send({ type: 'fatal_error', message: brand((err as Error).message) });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  }

  @Post('skills')
  @Roles('admin')
  createSkill(@Param('accountId') accountId: string, @Body() dto: SkillDto) {
    return this.service.createSkill(accountId, dto);
  }

  @Patch('skills/:skillId')
  @Roles('admin')
  updateSkill(
    @Param('accountId') accountId: string,
    @Param('skillId', ParseUUIDPipe) skillId: string,
    @Body() dto: UpdateSkillDto,
  ) {
    return this.service.updateSkill(accountId, skillId, dto);
  }

  @Delete('skills/:skillId')
  @Roles('admin')
  deleteSkill(
    @Param('accountId') accountId: string,
    @Param('skillId', ParseUUIDPipe) skillId: string,
  ) {
    return this.service.deleteSkill(accountId, skillId);
  }
}

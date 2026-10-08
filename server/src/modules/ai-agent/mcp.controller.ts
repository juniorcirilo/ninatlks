import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { handleMcp } from './mcp-protocol';
import { McpTokenService } from './mcp-token.service';
import { DbToolsService } from './db-tools.service';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Servidor MCP interno: só o OpenCode CLI (processo local, com token efêmero
 * da conversa) chama. Sem sessão de usuário — por isso é @Public() — e protegido
 * por token assinado + origem loopback sem cabeçalhos de proxy.
 */
@Public()
@Controller('mcp')
export class McpController {
  constructor(
    private readonly tokens: McpTokenService,
    private readonly tools: DbToolsService,
  ) {}

  @Post()
  @HttpCode(200)
  async rpc(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    const remote = req.socket.remoteAddress ?? '';
    if (
      !LOOPBACK.has(remote) ||
      req.headers['x-forwarded-for'] ||
      req.headers['x-real-ip']
    )
      throw new UnauthorizedException();
    const payload = this.tokens.verify(auth?.replace(/^Bearer\s+/i, ''));
    if (!payload) throw new UnauthorizedException();

    const r = await handleMcp(
      body,
      this.tools.backendFor({
        accountId: payload.acc,
        conversationId: payload.conv,
        personaId: payload.persona,
      }),
    );
    if (r.body === undefined) return res.status(r.status).end();
    return res.status(r.status).json(r.body);
  }
}

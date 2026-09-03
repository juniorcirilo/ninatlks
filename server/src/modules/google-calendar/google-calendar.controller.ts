import {
  Controller,
  Delete,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/authenticated-request';
import { GoogleCalendarService } from './google-calendar.service';

@UseGuards(AccountMemberGuard)
@Controller('accounts/:accountId/google-calendar')
export class GoogleCalendarController {
  constructor(private readonly googleCalendar: GoogleCalendarService) {}

  @Get('status')
  async status(@Param('accountId') accountId: string) {
    return {
      configured: await this.googleCalendar.isConfigured(accountId),
      redirectUri: this.googleCalendar.getRedirectUri(),
      ...(await this.googleCalendar.getStatus(accountId)),
    };
  }

  @UseGuards(RolesGuard)
  @Roles('admin')
  @Get('connect')
  async connect(
    @Param('accountId') accountId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return { url: await this.googleCalendar.getAuthUrl(accountId, user.id) };
  }

  @UseGuards(RolesGuard)
  @Roles('admin')
  @Delete()
  async disconnect(@Param('accountId') accountId: string) {
    await this.googleCalendar.disconnect(accountId);
    return { ok: true };
  }
}

/**
 * Rota pública separada (fora do prefixo `accounts/:accountId`): o Google
 * redireciona o navegador diretamente pra cá depois do consentimento, sem
 * accountId na URL — a conta/usuário vêm do `state` validado dentro de
 * `handleCallback`.
 */
@Controller('google-calendar')
export class GoogleCalendarCallbackController {
  constructor(private readonly googleCalendar: GoogleCalendarService) {}

  @Public()
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    // Em produção (nginx unifica API e web num único domínio — ver
    // docker-compose.yml) WEB_ORIGIN é deliberadamente deixado unset, então
    // um redirect relativo já cai no lugar certo. Em dev sem nginx (API e
    // web em portas diferentes) WEB_ORIGIN precisa estar setado, senão o
    // navegador ficaria preso na porta da API. Nunca prefixar com "/" na
    // ausência de WEB_ORIGIN: "/" + "/reunioes" vira "//reunioes", uma URL
    // protocol-relative que o navegador lê como host "reunioes".
    const target = process.env.WEB_ORIGIN
      ? `${process.env.WEB_ORIGIN.replace(/\/$/, '')}/reunioes`
      : '/reunioes';
    if (error || !code || !state) {
      res.redirect(`${target}?google_calendar=error`);
      return;
    }
    try {
      await this.googleCalendar.handleCallback(code, state);
      res.redirect(`${target}?google_calendar=connected`);
    } catch {
      res.redirect(`${target}?google_calendar=error`);
    }
  }
}

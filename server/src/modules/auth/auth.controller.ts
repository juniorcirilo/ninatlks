import {
  Body,
  Controller,
  Post,
  Get,
  HttpCode,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/authenticated-request';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { RegisterDto } from './dto/register.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? 'sid';
const COOKIE_TTL_MS =
  Number(process.env.SESSION_TTL_SECONDS ?? 60 * 60 * 24 * 30) * 1000;

function requestMeta(req: Request) {
  return { userAgent: req.headers['user-agent'], ip: req.ip };
}

function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_TTL_MS,
    path: '/',
  });
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, profile } = await this.authService.login(
      dto.email,
      dto.password,
      requestMeta(req),
    );
    setSessionCookie(res, token);
    return { profile };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logout(user.sessionId);
    res.clearCookie(COOKIE_NAME, { path: '/' });
  }

  @Get('me')
  async me(@CurrentUser() user: RequestUser) {
    const [profile, membership] = await Promise.all([
      this.authService.me(user.id),
      this.authService.primaryMembership(user.id),
    ]);
    return { profile, membership };
  }

  @Post('change-password')
  async changePassword(
    @CurrentUser() user: RequestUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }

  @Public()
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Public()
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.password);
  }

  @Public()
  @Post('register')
  @HttpCode(200)
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, profile } = await this.authService.register(
      dto.email,
      dto.name,
      dto.password,
      requestMeta(req),
    );
    setSessionCookie(res, token);
    return { profile };
  }

  @Public()
  @Post('invites/accept')
  @HttpCode(200)
  async acceptInvite(
    @Body() dto: AcceptInviteDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, profile } = await this.authService.acceptInvite(
      dto.token,
      dto.name,
      dto.password,
      requestMeta(req),
    );
    setSessionCookie(res, token);
    return { profile };
  }
}

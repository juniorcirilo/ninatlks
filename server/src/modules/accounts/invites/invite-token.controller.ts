import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { translatePgException } from '../../../common/pg-error.util';
import { InvitesService } from './invites.service';

/**
 * Token-addressed invite routes — not nested under /accounts/:accountId
 * since the token alone determines the account (preview) or the caller's
 * own session determines who's accepting (accept-as-current-user).
 */
@Controller('invites')
export class InviteTokenController {
  constructor(private readonly invitesService: InvitesService) {}

  @Public()
  @Get(':token/preview')
  async preview(@Param('token') token: string) {
    const preview = await this.invitesService.preview(token);
    if (!preview) throw new NotFoundException('Invite not found or expired');
    return preview;
  }

  @Post(':token/accept')
  async acceptAsCurrentUser(@Param('token') token: string) {
    try {
      const accountId = await this.invitesService.acceptAsCurrentUser(token);
      return { accountId };
    } catch (error) {
      translatePgException(error);
    }
  }
}

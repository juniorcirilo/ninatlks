import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AccountMemberGuard } from '../../../common/guards/account-member.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../../common/types/authenticated-request';
import { InvitesService } from './invites.service';
import { CreateInviteDto } from './dto/create-invite.dto';

@UseGuards(AccountMemberGuard, RolesGuard)
@Controller('accounts/:accountId/invites')
export class InvitesController {
  constructor(private readonly invitesService: InvitesService) {}

  @Roles('admin')
  @Get()
  list(@Param('accountId') accountId: string) {
    return this.invitesService.listForAccount(accountId);
  }

  @Roles('admin')
  @Post()
  create(
    @Param('accountId') accountId: string,
    @Body() dto: CreateInviteDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.invitesService.create({
      accountId,
      email: dto.email,
      role: dto.role,
      invitedByUserId: user.id,
    });
  }

  @Roles('admin')
  @Delete(':inviteId')
  revoke(
    @Param('accountId') accountId: string,
    @Param('inviteId') inviteId: string,
  ) {
    return this.invitesService.revoke(accountId, inviteId);
  }
}

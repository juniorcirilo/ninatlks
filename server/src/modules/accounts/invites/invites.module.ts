import { Module } from '@nestjs/common';
import { InvitesController } from './invites.controller';
import { InviteTokenController } from './invite-token.controller';
import { InvitesService } from './invites.service';

@Module({
  controllers: [InvitesController, InviteTokenController],
  providers: [InvitesService],
})
export class InvitesModule {}

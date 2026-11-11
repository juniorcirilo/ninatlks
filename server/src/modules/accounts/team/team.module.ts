import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PasswordService } from '../../auth/password/password.service';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';

@Module({
  imports: [AuthModule],
  controllers: [TeamController],
  providers: [TeamService, PasswordService],
})
export class TeamModule {}

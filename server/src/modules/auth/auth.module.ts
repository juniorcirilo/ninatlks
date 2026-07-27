import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Profiles } from '../../database/entities/accounts/profiles.entity';
import { Invites } from '../../database/entities/accounts/invites.entity';
import { AccountUsers } from '../../database/entities/accounts/account_users.entity';
import { UserRoles } from '../../database/entities/accounts/user_roles.entity';
import { Sessions } from '../../database/entities/accounts/sessions.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { PasswordService } from './password/password.service';
import { SessionStrategy } from './strategies/session.strategy';

@Module({
  imports: [
    PassportModule,
    TypeOrmModule.forFeature([
      Profiles,
      Invites,
      AccountUsers,
      UserRoles,
      Sessions,
      PasswordResetToken,
    ]),
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionService, PasswordService, SessionStrategy],
  exports: [SessionService],
})
export class AuthModule {}

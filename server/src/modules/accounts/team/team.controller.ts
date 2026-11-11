import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AccountMemberGuard } from '../../../common/guards/account-member.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { translatePgException } from '../../../common/pg-error.util';
import { TeamService } from './team.service';
import { ChangeRoleDto } from './dto/change-role.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { SetMemberPasswordDto } from './dto/set-password.dto';

@UseGuards(AccountMemberGuard, RolesGuard)
@Controller('accounts/:accountId/members')
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Get()
  async list(@Param('accountId') accountId: string) {
    return this.teamService.listMembers(accountId);
  }

  @Roles('admin')
  @Patch(':userId/role')
  async changeRole(
    @Param('accountId') accountId: string,
    @Param('userId') userId: string,
    @Body() dto: ChangeRoleDto,
  ) {
    try {
      await this.teamService.changeRole(accountId, userId, dto.role);
    } catch (error) {
      translatePgException(error);
    }
  }

  @Roles('admin')
  @Patch(':userId')
  async update(
    @Param('accountId') accountId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    try {
      await this.teamService.updateMember(accountId, userId, dto.name, dto.email);
    } catch (error) {
      translatePgException(error);
    }
  }

  @Roles('admin')
  @Put(':userId/password')
  async setPassword(
    @Param('accountId') accountId: string,
    @Param('userId') userId: string,
    @Body() dto: SetMemberPasswordDto,
  ) {
    try {
      return await this.teamService.setPassword(accountId, userId, dto.password);
    } catch (error) {
      translatePgException(error);
    }
  }

  @Roles('admin')
  @Delete(':userId')
  async remove(
    @Param('accountId') accountId: string,
    @Param('userId') userId: string,
  ) {
    try {
      await this.teamService.removeMember(accountId, userId);
    } catch (error) {
      translatePgException(error);
    }
  }
}

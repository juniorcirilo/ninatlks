import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CadencesService } from './cadences.service';
import { UpsertCadenceDto, EnrollContactDto } from './dto/cadence.dto';

@UseGuards(AccountMemberGuard, RolesGuard)
@Controller('accounts/:accountId/cadences')
export class CadencesController {
  constructor(private readonly service: CadencesService) {}

  @Get()
  list(@Param('accountId') accountId: string) {
    return this.service.list(accountId);
  }

  @Roles('admin')
  @Post()
  async upsert(
    @Param('accountId') accountId: string,
    @Body() dto: UpsertCadenceDto,
  ) {
    const id = await this.service.upsert(accountId, dto);
    return { id };
  }

  @Roles('admin')
  @Delete(':id')
  remove(@Param('accountId') accountId: string, @Param('id') id: string) {
    return this.service.remove(accountId, id);
  }

  @Post(':id/enroll')
  async enroll(@Param('id') id: string, @Body() dto: EnrollContactDto) {
    const executionId = await this.service.enroll(id, dto.contactId);
    return { executionId };
  }
}

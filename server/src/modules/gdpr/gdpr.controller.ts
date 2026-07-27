import {
  Body,
  Controller,
  Delete,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GdprService } from './gdpr.service';
import { MergeContactsDto } from './dto/merge-contacts.dto';

@UseGuards(AccountMemberGuard, RolesGuard)
@Controller('accounts/:accountId/contacts')
export class GdprController {
  constructor(private readonly gdprService: GdprService) {}

  @Delete(':id/lgpd')
  @Roles('admin')
  lgpdDelete(@Param('accountId') _accountId: string, @Param('id') id: string) {
    return this.gdprService.lgpdDeleteContact(id);
  }

  @Post('merge')
  @Roles('admin')
  merge(@Param('accountId') _accountId: string, @Body() dto: MergeContactsDto) {
    return this.gdprService.mergeContacts(dto.primaryId, dto.duplicateIds);
  }
}

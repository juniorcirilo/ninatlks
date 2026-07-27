import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ComplianceService } from './compliance.service';
import { AddDncDto } from './dto/add-dnc.dto';
import { SaveCompliancePolicyDto } from './dto/save-compliance-policy.dto';

@UseGuards(AccountMemberGuard, RolesGuard)
@Controller('accounts/:accountId/dnc')
export class DncController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Get()
  list(@Param('accountId') accountId: string) {
    return this.complianceService.listDnc(accountId);
  }

  @Post()
  add(@Param('accountId') accountId: string, @Body() dto: AddDncDto) {
    return this.complianceService.addToDnc(
      accountId,
      dto.phoneNumber,
      dto.reason,
      dto.notes,
    );
  }

  @Delete(':id')
  @Roles('admin')
  remove(
    @Param('accountId') accountId: string,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.complianceService.removeFromDnc(accountId, id);
  }
}

@UseGuards(AccountMemberGuard, RolesGuard)
@Controller('accounts/:accountId/compliance-policy')
export class CompliancePolicyController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Get()
  get(@Param('accountId') accountId: string) {
    return this.complianceService.getCompliancePolicy(accountId);
  }

  @Put()
  @Roles('admin')
  save(
    @Param('accountId') accountId: string,
    @Body() dto: SaveCompliancePolicyDto,
  ) {
    return this.complianceService.saveCompliancePolicy(accountId, dto.policy);
  }
}

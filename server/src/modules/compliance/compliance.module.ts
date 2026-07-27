import { Module } from '@nestjs/common';
import {
  DncController,
  CompliancePolicyController,
} from './compliance.controller';
import { ComplianceService } from './compliance.service';

@Module({
  controllers: [DncController, CompliancePolicyController],
  providers: [ComplianceService],
})
export class ComplianceModule {}

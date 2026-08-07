import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/authenticated-request';
import { CampaignsService } from './campaigns.service';
import { CallOpsService } from '../voice/call-ops.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { UpdateCampaignStatusDto } from './dto/update-campaign-status.dto';
import { UpsertRetentionRuleDto } from './dto/upsert-retention-rule.dto';

@UseGuards(AccountMemberGuard)
@Controller('accounts/:accountId/campaigns')
export class CampaignsController {
  constructor(
    private readonly campaignsService: CampaignsService,
    private readonly callOps: CallOpsService,
  ) {}

  @Get()
  list(@Param('accountId') accountId: string) {
    return this.campaignsService.list(accountId);
  }

  @Post()
  create(
    @Param('accountId') accountId: string,
    @Body() dto: CreateCampaignDto,
  ) {
    return this.campaignsService.create(accountId, dto);
  }

  @Patch(':id')
  update(
    @Param('accountId') accountId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.campaignsService.update(accountId, id, dto);
  }

  @Delete(':id')
  remove(@Param('accountId') accountId: string, @Param('id') id: string) {
    return this.campaignsService.remove(accountId, id);
  }

  /**
   * Fila de aprovação de uma campanha viva: os lotes que a carga do ERP
   * enfileirou e ainda esperam decisão, mais o histórico dos já decididos.
   */
  @Get(':id/batches')
  batches(@Param('accountId') accountId: string, @Param('id') id: string) {
    return this.campaignsService.listEnrollmentBatches(accountId, id);
  }

  @Get(':id/batches/:batchId/preview')
  batchPreview(
    @Param('accountId') accountId: string,
    @Param('batchId') batchId: string,
  ) {
    return this.campaignsService.previewEnrollmentBatch(accountId, batchId);
  }

  @Post(':id/batches/:batchId/approve')
  approveBatch(
    @Param('accountId') accountId: string,
    @Param('id') id: string,
    @Param('batchId') batchId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.campaignsService.decideEnrollmentBatch(
      accountId,
      id,
      batchId,
      user.id,
      'approve',
    );
  }

  @Post(':id/batches/:batchId/reject')
  rejectBatch(
    @Param('accountId') accountId: string,
    @Param('id') id: string,
    @Param('batchId') batchId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.campaignsService.decideEnrollmentBatch(
      accountId,
      id,
      batchId,
      user.id,
      'reject',
    );
  }

  @Get('personas')
  personas(@Param('accountId') accountId: string) {
    return this.campaignsService.listPersonas(accountId);
  }

  @Get('phone-numbers')
  phoneNumbers(@Param('accountId') accountId: string) {
    return this.campaignsService.listPhoneNumbers(accountId);
  }

  @Get('contact-lists')
  contactLists(@Param('accountId') accountId: string) {
    return this.campaignsService.listContactLists(accountId);
  }

  @Get(':id')
  get(@Param('accountId') accountId: string, @Param('id') id: string) {
    return this.campaignsService.get(accountId, id);
  }

  @Get(':id/contacts')
  contacts(@Param('accountId') accountId: string, @Param('id') id: string) {
    return this.campaignsService.listContacts(accountId, id);
  }

  @Post(':id/export')
  async exportCsv(
    @Param('accountId') accountId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { filename, csv } = await this.campaignsService.exportCsv(
      accountId,
      id,
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('accountId') accountId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCampaignStatusDto,
  ) {
    return this.campaignsService.updateStatus(accountId, id, dto.status);
  }

  /**
   * Ported from supabase/functions/voice-call-cancel (campaign_id branch) —
   * hard-stops in-flight calls (Twilio hangup + best-effort EL conversation
   * delete) and frees not-yet-dispatched contacts, distinct from
   * updateStatus() above which only flips voice_campaigns.status.
   */
  @Post(':id/cancel-calls')
  cancelCalls(
    @Param('accountId') accountId: string,
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.callOps.cancel(accountId, { campaignId: id }, user.id);
  }
}

@UseGuards(AccountMemberGuard)
@Controller('accounts/:accountId/retention-rules')
export class RetentionRulesController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  list(@Param('accountId') accountId: string) {
    return this.campaignsService.listRetentionRules(accountId);
  }

  @Post()
  create(
    @Param('accountId') accountId: string,
    @Body() dto: UpsertRetentionRuleDto,
  ) {
    return this.campaignsService.upsertRetentionRule(accountId, undefined, dto);
  }

  @Patch(':id')
  update(
    @Param('accountId') accountId: string,
    @Param('id') id: string,
    @Body() dto: UpsertRetentionRuleDto,
  ) {
    return this.campaignsService.upsertRetentionRule(accountId, id, dto);
  }

  @Delete(':id')
  delete(@Param('accountId') accountId: string, @Param('id') id: string) {
    return this.campaignsService.deleteRetentionRule(accountId, id);
  }
}

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { ContactsService } from './contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactOpsDto } from './dto/update-contact-ops.dto';
import { ImportContactsDto } from './dto/import-contacts.dto';
import {
  BulkAssignOwnerDto,
  BulkSetLifecycleDto,
  BulkSetOperationalStatusDto,
  BulkAddTagDto,
  BulkRoundRobinDto,
  BulkAddToCampaignDto,
} from './dto/bulk-contacts.dto';
import { CreateListDto, AddToListDto } from './dto/create-list.dto';

@UseGuards(AccountMemberGuard)
@Controller('accounts/:accountId/contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get()
  list(@Param('accountId') accountId: string) {
    return this.contactsService.listCentral(accountId);
  }

  @Post()
  create(@Param('accountId') accountId: string, @Body() dto: CreateContactDto) {
    return this.contactsService.create(accountId, dto);
  }

  @Patch(':id')
  updateOps(
    @Param('accountId') accountId: string,
    @Param('id') id: string,
    @Body() dto: UpdateContactOpsDto,
  ) {
    return this.contactsService.updateOps(accountId, id, dto);
  }

  @Post('import')
  importCsv(
    @Param('accountId') accountId: string,
    @Body() dto: ImportContactsDto,
  ) {
    return this.contactsService.importCsv(accountId, dto.rows);
  }

  @Post('bulk/owner')
  bulkAssignOwner(
    @Param('accountId') accountId: string,
    @Body() dto: BulkAssignOwnerDto,
  ) {
    return this.contactsService.bulkAssignOwner(
      accountId,
      dto.contactIds,
      dto.ownerUserId ?? null,
    );
  }

  @Post('bulk/lifecycle')
  bulkSetLifecycle(
    @Param('accountId') accountId: string,
    @Body() dto: BulkSetLifecycleDto,
  ) {
    return this.contactsService.bulkSetLifecycle(
      accountId,
      dto.contactIds,
      dto.stage,
    );
  }

  @Post('bulk/operational-status')
  bulkSetOperationalStatus(
    @Param('accountId') accountId: string,
    @Body() dto: BulkSetOperationalStatusDto,
  ) {
    return this.contactsService.bulkSetOperationalStatus(
      accountId,
      dto.contactIds,
      dto.status,
    );
  }

  @Post('bulk/tag')
  bulkAddTag(
    @Param('accountId') accountId: string,
    @Body() dto: BulkAddTagDto,
  ) {
    return this.contactsService.bulkAddTag(accountId, dto.contactIds, dto.tag);
  }

  @Post('bulk/round-robin')
  bulkRoundRobin(
    @Param('accountId') accountId: string,
    @Body() dto: BulkRoundRobinDto,
  ) {
    return this.contactsService.bulkAssignRoundRobin(
      accountId,
      dto.contactIds,
      dto.ownerIds,
    );
  }

  @Post('bulk/campaign')
  bulkAddToCampaign(
    @Param('accountId') accountId: string,
    @Body() dto: BulkAddToCampaignDto,
  ) {
    return this.contactsService.bulkAddToCampaign(
      accountId,
      dto.campaignId,
      dto.contacts,
    );
  }

  @Get('tags/suggestions')
  tagSuggestions(@Param('accountId') accountId: string) {
    return this.contactsService.fetchTagSuggestions(accountId);
  }

  @Get('productivity')
  productivity(@Param('accountId') accountId: string) {
    return this.contactsService.fetchProductivity(accountId);
  }

  @Get(':id/timeline')
  timeline(@Param('accountId') accountId: string, @Param('id') id: string) {
    return this.contactsService.fetchTimeline(accountId, id);
  }

  @Get('editable-campaigns')
  editableCampaigns(@Param('accountId') accountId: string) {
    return this.contactsService.listEditableCampaigns(accountId);
  }
}

@UseGuards(AccountMemberGuard)
@Controller('accounts/:accountId/contact-lists')
export class ContactListsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get()
  list(@Param('accountId') accountId: string) {
    return this.contactsService.listContactLists(accountId);
  }

  @Post()
  create(@Param('accountId') accountId: string, @Body() dto: CreateListDto) {
    return this.contactsService.createListFromContacts(
      accountId,
      dto.name,
      dto.contactIds,
    );
  }

  @Get(':listId')
  getOne(@Param('accountId') accountId: string, @Param('listId') listId: string) {
    return this.contactsService.getContactList(accountId, listId);
  }

  @Patch(':listId')
  update(
    @Param('accountId') accountId: string,
    @Param('listId') listId: string,
    @Body() body: { name?: string; description?: string | null; campaignKind?: string; filters?: Record<string, unknown> },
  ) {
    return this.contactsService.updateContactList(accountId, listId, body);
  }

  @Delete(':listId')
  remove(@Param('accountId') accountId: string, @Param('listId') listId: string) {
    return this.contactsService.deleteContactList(accountId, listId);
  }

  @Post(':listId/members')
  addMembers(
    @Param('accountId') accountId: string,
    @Param('listId') listId: string,
    @Body() dto: AddToListDto,
  ) {
    return this.contactsService.addContactsToList(
      accountId,
      listId,
      dto.contactIds,
    );
  }

  @Get(':listId/members')
  listMembers(@Param('accountId') accountId: string, @Param('listId') listId: string) {
    return this.contactsService.listContactListMembers(accountId, listId);
  }
}

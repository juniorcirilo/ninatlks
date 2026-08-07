import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { ConversationsService } from './conversations.service';
import { ListMessagesDto } from './dto/list-messages.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';

@UseGuards(AccountMemberGuard)
@Controller('accounts/:accountId/conversations')
export class ConversationsController {
  constructor(private readonly service: ConversationsService) {}

  @Get()
  list(
    @Param('accountId') accountId: string,
    @Query('contactId') contactId?: string,
  ) {
    return this.service.list(accountId, contactId);
  }

  @Get(':conversationId/messages')
  messages(
    @Param('accountId') accountId: string,
    @Param('conversationId') conversationId: string,
    @Query() query: ListMessagesDto,
  ) {
    return this.service.messages(
      accountId,
      conversationId,
      query.before,
      query.limit ?? 50,
    );
  }

  @Patch(':conversationId')
  update(
    @Param('accountId') accountId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: UpdateConversationDto,
  ) {
    return this.service.update(accountId, conversationId, dto);
  }
}

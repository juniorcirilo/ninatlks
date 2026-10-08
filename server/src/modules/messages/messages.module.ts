import { Module } from '@nestjs/common';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { AiAgentModule } from '../ai-agent/ai-agent.module';
import { SpeechModule } from '../speech/speech.module';
import { ChatSendController } from './chat-send.controller';
import { ChatSendService } from './chat-send.service';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { InteractiveDraftService } from './interactive-draft.service';
import { PersonaAutoReplyService } from './persona-auto-reply.service';

@Module({
  imports: [WhatsAppModule, SpeechModule, AiAgentModule],
  controllers: [ChatSendController, ConversationsController],
  providers: [
    ChatSendService,
    ConversationsService,
    PersonaAutoReplyService,
    InteractiveDraftService,
  ],
  exports: [ChatSendService, PersonaAutoReplyService],
})
export class MessagesModule {}

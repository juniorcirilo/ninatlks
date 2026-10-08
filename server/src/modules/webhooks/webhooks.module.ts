import { Module } from '@nestjs/common';
import { TwilioWebhooksController } from './twilio-webhooks.controller';
import { MetaWebhooksController } from './meta-webhooks.controller';
import { ElevenLabsWebhooksController } from './elevenlabs-webhooks.controller';
import { TwilioVoiceService } from './twilio-voice.service';
import { TwilioSmsService } from './twilio-sms.service';
import { WaEventsService } from './wa-events.service';
import { InboundMessageService } from './inbound-message.service';
import { VoiceModule } from '../voice/voice.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SpeechModule } from '../speech/speech.module';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [
    VoiceModule,
    MessagesModule,
    RealtimeModule,
    WhatsAppModule,
    SpeechModule,
  ],
  controllers: [
    TwilioWebhooksController,
    MetaWebhooksController,
    ElevenLabsWebhooksController,
  ],
  providers: [
    TwilioVoiceService,
    TwilioSmsService,
    WaEventsService,
    InboundMessageService,
  ],
})
export class WebhooksModule {}

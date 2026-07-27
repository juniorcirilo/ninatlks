import { Module } from '@nestjs/common';
import { TwilioWebhooksController } from './twilio-webhooks.controller';
import { EvolutionWebhooksController } from './evolution-webhooks.controller';
import { MetaWebhooksController } from './meta-webhooks.controller';
import { ElevenLabsWebhooksController } from './elevenlabs-webhooks.controller';
import { TwilioVoiceService } from './twilio-voice.service';
import { TwilioSmsService } from './twilio-sms.service';
import { EvolutionWebhooksService } from './evolution-webhooks.service';
import { InboundMessageService } from './inbound-message.service';
import { VoiceModule } from '../voice/voice.module';

@Module({
  imports: [VoiceModule],
  controllers: [
    TwilioWebhooksController,
    EvolutionWebhooksController,
    MetaWebhooksController,
    ElevenLabsWebhooksController,
  ],
  providers: [
    TwilioVoiceService,
    TwilioSmsService,
    EvolutionWebhooksService,
    InboundMessageService,
  ],
})
export class WebhooksModule {}

import { Module } from '@nestjs/common';
import { TwilioModule } from '../twilio/twilio.module';
import { ElevenLabsModule } from '../elevenlabs/elevenlabs.module';
import { PhoneNumbersController } from './phone-numbers.controller';
import { PhoneNumbersService } from './phone-numbers.service';
import { VoiceOutboundController } from './voice-outbound.controller';
import { VoiceOutboundService } from './voice-outbound.service';
import { VoiceElOutboundService } from './voice-el-outbound.service';
import { VoiceGuardService } from './voice-guard.service';
import { VoiceCallsService } from './voice-calls.service';
import { ElevenLabsPhoneService } from './elevenlabs-phone.service';
import { VoiceCloneService } from './voice-clone.service';
import { VoiceCloneController } from './voice-clone.controller';
import { ConversationRelayService } from './conversation-relay.service';
import { CallSentimentService } from './call-sentiment.service';
import { CallClassificationService } from './call-classification.service';
import { CallFinalizeService } from './call-finalize.service';
import { CallTranscriptionService } from './call-transcription.service';
import { CallSummaryService } from './call-summary.service';
import { CallPersonalizationService } from './call-personalization.service';
import { CallOpsService } from './call-ops.service';

@Module({
  imports: [TwilioModule, ElevenLabsModule],
  controllers: [
    PhoneNumbersController,
    VoiceOutboundController,
    VoiceCloneController,
  ],
  providers: [
    PhoneNumbersService,
    VoiceOutboundService,
    VoiceElOutboundService,
    VoiceGuardService,
    VoiceCallsService,
    ElevenLabsPhoneService,
    VoiceCloneService,
    ConversationRelayService,
    CallSentimentService,
    CallClassificationService,
    CallFinalizeService,
    CallTranscriptionService,
    CallSummaryService,
    CallPersonalizationService,
    CallOpsService,
  ],
  exports: [
    ConversationRelayService,
    CallFinalizeService,
    CallClassificationService,
    CallSentimentService,
    CallTranscriptionService,
    CallSummaryService,
    CallPersonalizationService,
    CallOpsService,
  ],
})
export class VoiceModule {}

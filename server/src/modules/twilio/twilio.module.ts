import { Global, Module } from '@nestjs/common';
import { TwilioNumbersController } from './twilio-numbers.controller';
import { TwilioClientService } from './twilio-client.service';
import { TwilioConfigService } from './twilio-config.service';
import { TwilioNumbersService } from './twilio-numbers.service';
import { TwilioPhoneNumbersService } from './twilio-phone-numbers.service';

@Global()
@Module({
  controllers: [TwilioNumbersController],
  providers: [
    TwilioClientService,
    TwilioConfigService,
    TwilioNumbersService,
    TwilioPhoneNumbersService,
  ],
  exports: [TwilioClientService, TwilioConfigService, TwilioNumbersService],
})
export class TwilioModule {}

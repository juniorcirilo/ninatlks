import { Module } from '@nestjs/common';
import { AccountSettingsController } from './account-settings.controller';
import { AccountSettingsService } from './account-settings.service';

@Module({
  controllers: [AccountSettingsController],
  providers: [AccountSettingsService],
})
export class AccountSettingsModule {}

import { Global, Module } from '@nestjs/common';
import { AttachmentsController } from './attachments.controller';
import { StorageService } from './storage.service';

@Global()
@Module({
  controllers: [AttachmentsController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}

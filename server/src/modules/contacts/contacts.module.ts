import { Module } from '@nestjs/common';
import {
  ContactsController,
  ContactListsController,
} from './contacts.controller';
import { ContactsService } from './contacts.service';

@Module({
  controllers: [ContactsController, ContactListsController],
  providers: [ContactsService],
})
export class ContactsModule {}

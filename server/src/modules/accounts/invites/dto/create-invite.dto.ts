import { IsEmail, IsIn } from 'class-validator';

export class CreateInviteDto {
  @IsEmail()
  email!: string;

  @IsIn(['admin', 'agent'])
  role!: 'admin' | 'agent';
}

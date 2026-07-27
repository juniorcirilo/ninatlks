import { IsIn } from 'class-validator';

export class ChangeRoleDto {
  @IsIn(['admin', 'agent'])
  role!: 'admin' | 'agent';
}

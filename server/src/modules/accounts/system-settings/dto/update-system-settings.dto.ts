import { IsBoolean } from 'class-validator';

export class UpdateSystemSettingsDto {
  @IsBoolean()
  registrationEnabled!: boolean;
}

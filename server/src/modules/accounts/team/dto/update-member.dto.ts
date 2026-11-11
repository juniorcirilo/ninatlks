import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateMemberDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;
}

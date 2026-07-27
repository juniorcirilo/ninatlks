import { IsArray, IsString, IsUUID } from 'class-validator';

export class CreateListDto {
  @IsString()
  name!: string;

  @IsArray()
  @IsUUID('4', { each: true })
  contactIds!: string[];
}

export class AddToListDto {
  @IsArray()
  @IsUUID('4', { each: true })
  contactIds!: string[];
}

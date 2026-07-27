import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class MergeContactsDto {
  @IsUUID()
  primaryId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  duplicateIds!: string[];
}

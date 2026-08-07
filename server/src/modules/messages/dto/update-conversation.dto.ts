import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateConversationDto {
  @IsOptional()
  @IsBoolean()
  aiAutopilotEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  markRead?: boolean;
}

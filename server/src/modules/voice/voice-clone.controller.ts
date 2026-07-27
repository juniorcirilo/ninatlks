import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { VoiceCloneService } from './voice-clone.service';
import { VoiceCloneDto } from './dto/voice-clone.dto';

@UseGuards(AccountMemberGuard, RolesGuard)
@Roles('admin')
@Controller('accounts/:accountId/voice-clone')
export class VoiceCloneController {
  constructor(private readonly service: VoiceCloneService) {}

  @Post()
  clone(@Param('accountId') accountId: string, @Body() dto: VoiceCloneDto) {
    return this.service.clone(accountId, dto.personaId, {
      audioBase64: dto.audioBase64,
      filename: dto.filename,
      mimeType: dto.mimeType,
    });
  }
}

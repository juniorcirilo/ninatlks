import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../../common/decorators/public.decorator';
import { isWebhookVerificationDisabled } from '../../common/webhook-security.util';
import { EvolutionWebhooksService } from './evolution-webhooks.service';
import type { EvolutionPayload } from './evolution-webhooks.service';

/**
 * Ported from supabase/functions/evolution-incoming/index.ts. The original
 * had NO authentication at all on this endpoint — anyone could POST fake
 * inbound messages. Fixed here: the `x-nina-webhook-secret` header is set
 * on every instance we provision (see EvolutionClientService.webhookBody)
 * and verified against EVOLUTION_WEBHOOK_SECRET before processing.
 */
@Controller('webhooks/evolution')
export class EvolutionWebhooksController {
  constructor(private readonly service: EvolutionWebhooksService) {}

  @Public()
  @Post('incoming')
  @HttpCode(200)
  async incoming(
    @Body() payload: EvolutionPayload,
    @Headers('x-nina-webhook-secret') provided: string | undefined,
  ) {
    if (!isWebhookVerificationDisabled()) {
      const expected = process.env.EVOLUTION_WEBHOOK_SECRET ?? '';
      if (!expected || !provided || !this.safeEqual(provided, expected)) {
        throw new UnauthorizedException('invalid webhook secret');
      }
    }
    return this.service.handle(payload);
  }

  private safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}

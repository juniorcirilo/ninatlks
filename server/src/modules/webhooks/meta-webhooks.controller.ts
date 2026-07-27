import {
  Body,
  Controller,
  HttpCode,
  InternalServerErrorException,
  Post,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Public } from '../../common/decorators/public.decorator';
import { DataSource } from 'typeorm';

/**
 * Meta Data Deletion Callback — required by Meta App Review. When a user
 * removes our app from Facebook/Instagram, Meta POSTs here with a
 * signed_request; we must return JSON with { url, confirmation_code }.
 * Ported 1:1 from supabase/functions/meta-data-deletion/index.ts.
 */
@Controller('webhooks/meta')
export class MetaWebhooksController {
  constructor(private readonly dataSource: DataSource) {}

  @Public()
  @Post('data-deletion')
  @HttpCode(200)
  async dataDeletion(@Body() body: { signed_request?: string }) {
    const signedRequest =
      typeof body?.signed_request === 'string' ? body.signed_request : '';
    const appSecret = process.env.META_APP_SECRET ?? '';
    const payload = this.parseSignedRequest(signedRequest, appSecret);

    if (!payload) {
      return { error: 'invalid signed_request' };
    }
    const userId = typeof payload.user_id === 'string' ? payload.user_id : '';
    if (!userId) {
      return { error: 'missing user_id' };
    }

    const rows = await this.dataSource.query<{ confirmation_id: string }[]>(
      `INSERT INTO data_deletion_requests (source, meta_user_id, raw_payload)
         VALUES ('meta_callback', $1, $2::jsonb)
         RETURNING confirmation_id`,
      [userId, JSON.stringify({ signed_request_payload: payload })],
    );
    const row = rows[0];

    if (!row) {
      throw new InternalServerErrorException('failed to queue');
    }

    const baseUrl = process.env.APP_BASE_URL ?? 'https://nexus.viverdeia.ai';
    const statusUrl = `${baseUrl}/data-deletion?confirmation=${encodeURIComponent(row.confirmation_id)}`;

    return { url: statusUrl, confirmation_code: row.confirmation_id };
  }

  private parseSignedRequest(
    signedRequest: string,
    appSecret: string,
  ): Record<string, unknown> | null {
    if (!signedRequest || !appSecret) return null;
    const parts = signedRequest.split('.');
    if (parts.length !== 2) return null;
    const [sigB64, payloadB64] = parts;

    try {
      const expected = createHmac('sha256', appSecret)
        .update(payloadB64)
        .digest();
      const received = this.base64UrlDecode(sigB64);
      if (
        expected.length !== received.length ||
        !timingSafeEqual(expected, received)
      ) {
        return null;
      }
      const payloadJson = this.base64UrlDecode(payloadB64).toString('utf8');
      return JSON.parse(payloadJson) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private base64UrlDecode(str: string): Buffer {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    return Buffer.from(b64 + pad, 'base64');
  }
}

import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as exempt from session auth + the tenant RLS transaction
 * (health checks, provider webhooks that authenticate via signature instead).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

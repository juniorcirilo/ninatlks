import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Response } from 'express';

/**
 * Provider client errors (TwilioError/TwilioConfigError, and the Evolution/
 * ElevenLabs/Meta equivalents) are plain Error subclasses carrying a
 * `status` field — not NestJS HttpExceptions, so without this filter they'd
 * fall through to the default 500 handler regardless of the real cause
 * (missing credentials → 409, upstream auth failure → 401/403, etc.).
 * Registered globally in main.ts. Everything else (HttpExceptions, genuine
 * unhandled errors) is delegated to Nest's BaseExceptionFilter unchanged.
 */
@Catch()
export class ProviderErrorFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    if (!(exception instanceof HttpException)) {
      const err = exception as {
        status?: unknown;
        message?: unknown;
        name?: string;
      };
      if (typeof err?.status === 'number') {
        const response = host.switchToHttp().getResponse<Response>();
        response.status(err.status).json({
          statusCode: err.status,
          message:
            typeof err.message === 'string'
              ? err.message
              : 'Provider request failed',
          error: err.name ?? 'ProviderError',
        });
        return;
      }
    }
    super.catch(exception, host);
  }
}

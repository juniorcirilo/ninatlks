import { ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Request, Response } from 'express';

/**
 * Provider client errors (TwilioError/TwilioConfigError, and the Evolution/
 * ElevenLabs/Meta equivalents) are plain Error subclasses carrying a
 * `status` field — not NestJS HttpExceptions, so without this filter they'd
 * fall through to the default 500 handler regardless of the real cause
 * (missing credentials → 409, upstream auth failure → 401/403, etc.).
 * Registered globally in main.ts. Everything else (HttpExceptions, genuine
 * unhandled errors) is delegated to Nest's BaseExceptionFilter unchanged.
 *
 * The mapped response goes only to the caller's browser, so an upstream
 * rejection left no server-side trace at all — a provider 401/400 was
 * indistinguishable from an auth-guard one without asking the user to read
 * their network tab. The warn below closes that gap; provider errors are
 * expected-ish (bad credentials, upstream validation) so they log at warn,
 * not error.
 */
@Catch()
export class ProviderErrorFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(ProviderErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (!(exception instanceof HttpException)) {
      const err = exception as {
        status?: unknown;
        message?: unknown;
        name?: string;
      };
      if (typeof err?.status === 'number') {
        const http = host.switchToHttp();
        const response = http.getResponse<Response>();
        const request = http.getRequest<Request>();
        const details = (exception as { details?: unknown })?.details;
        this.logger.warn(
          `${err.name ?? 'ProviderError'} ${err.status} on ${request.method} ${request.originalUrl}: ${
            typeof err.message === 'string' ? err.message : 'no message'
          }${details ? ` | details=${JSON.stringify(details)}` : ''}`,
        );
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

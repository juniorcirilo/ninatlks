import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ContextIdFactory, ModuleRef, Reflector } from '@nestjs/core';
import { catchError, concatMap, finalize, Observable } from 'rxjs';
import { DataSource } from 'typeorm';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { TenantTxHost } from '../tenant-tx.host';
import type { AuthenticatedRequest } from '../types/authenticated-request';

/**
 * Opens one QueryRunner + transaction per request, sets the two RLS session
 * vars the Postgres functions is_account_member()/has_role() will read
 * (replacing auth.uid()), and hands it to the request-scoped TenantTxHost so
 * domain services can use it via `tx.manager`.
 *
 * Routes marked @Public() (health checks, provider webhooks authenticated by
 * signature instead of session) skip this entirely — they don't need
 * RLS-scoped access, and public endpoints must not hold a transaction open.
 *
 * Deliberately singleton-scoped (NOT constructor-injecting TenantTxHost —
 * that would make this request-scoped too, since Nest propagates scope
 * upward). This is registered as APP_INTERCEPTOR, and a request-scoped
 * APP_INTERCEPTOR proved unreliable at resolving its OTHER constructor deps
 * (Reflector came back undefined at runtime — confirmed by a boot test, not
 * something tsc/lint catch). Resolving TenantTxHost per-request via
 * ModuleRef instead is the Nest-documented pattern for "use a request-scoped
 * provider from a singleton" and sidesteps the whole problem.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(
    private readonly dataSource: DataSource,
    private readonly reflector: Reflector,
    private readonly moduleRef: ModuleRef,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const contextId = ContextIdFactory.getByRequest(request);
    const txHost = await this.moduleRef.resolve(TenantTxHost, contextId, {
      strict: false,
    });

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.query(
        `SELECT set_config('app.current_user_id', $1, true)`,
        [request.user?.id ?? ''],
      );
      await queryRunner.query(
        `SELECT set_config('app.current_account_id', $1, true)`,
        [request.activeAccountId ?? ''],
      );
    } catch (error) {
      await queryRunner.release();
      throw error;
    }

    txHost.queryRunner = queryRunner;

    // `released` evita liberar duas vezes; o finalize cobre cliente que aborta
    // (a subscription é cancelada sem passar por next/error) e devolve a conexão.
    let released = false;
    const release = async (action: 'commit' | 'rollback') => {
      if (released) return;
      released = true;
      try {
        if (action === 'commit') await queryRunner.commitTransaction();
        else await queryRunner.rollbackTransaction();
      } finally {
        await queryRunner.release();
      }
    };

    return next.handle().pipe(
      concatMap(async (data: unknown) => {
        await release('commit');
        return data;
      }),
      catchError(async (error: unknown) => {
        await release('rollback');
        throw error;
      }),
      finalize(() => {
        void release('rollback').catch(() => undefined);
      }),
    );
  }
}

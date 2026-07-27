import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Patch,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Public } from '../../../common/decorators/public.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../../common/types/authenticated-request';
import { SystemSettings } from '../../../database/entities/accounts/system_settings.entity';
import { TenantTxHost } from '../../../common/tenant-tx.host';
import { UpdateSystemSettingsDto } from './dto/update-system-settings.dto';

/**
 * Global (not per-account) settings — read is public (the login page's "is
 * self-signup open?" toggle needs it pre-auth), write is restricted to
 * is_super_admin (matches the final RLS policy in
 * supabase/migrations/20260522174606_...sql, "lock down writes to super
 * admins").
 *
 * GET is @Public(): TenantContextInterceptor never runs for it, so the
 * plain injected repository (default pool, no session vars) is fine — the
 * SELECT policy is `USING true` for the `authenticated`-role-member app
 * connection, not keyed on auth.uid() at all.
 *
 * PATCH is authenticated, so the interceptor *does* open a transaction and
 * set app.current_user_id — but only on its own dedicated QueryRunner, not
 * on whatever connection a plain @InjectRepository call happens to pull
 * from the pool. The super-admin check and the write both depend on
 * auth.uid() resolving correctly, so this needs TenantTxHost.manager, same
 * as every tenant-scoped module (this table itself isn't tenant-scoped, but
 * the RLS policies on it still key off auth.uid()).
 */
@Controller('system-settings')
export class SystemSettingsController {
  constructor(
    @InjectRepository(SystemSettings)
    private readonly systemSettings: Repository<SystemSettings>,
    private readonly tx: TenantTxHost,
  ) {}

  @Public()
  @Get()
  async get() {
    const [row] = await this.systemSettings.find({ take: 1 });
    return { registrationEnabled: row?.registrationEnabled ?? true };
  }

  @Patch()
  async update(
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateSystemSettingsDto,
  ) {
    const [isSuperAdmin] = await this.tx.manager.query<{ is_super_admin: boolean }[]>(
      `SELECT is_super_admin FROM public.profiles WHERE id = $1`,
      [user.id],
    );
    if (!isSuperAdmin?.is_super_admin)
      throw new ForbiddenException('Super admin only');

    const repo = this.tx.manager.getRepository(SystemSettings);
    const [row] = await repo.find({ take: 1 });
    if (row) {
      await repo.update({ id: row.id }, { registrationEnabled: dto.registrationEnabled });
    } else {
      await repo.insert({ registrationEnabled: dto.registrationEnabled });
    }
    return { registrationEnabled: dto.registrationEnabled };
  }
}

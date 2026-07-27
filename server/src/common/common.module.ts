import { Global, Module } from '@nestjs/common';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { AccountMemberGuard } from './guards/account-member.guard';
import { RolesGuard } from './guards/roles.guard';
import { TenantTxHost } from './tenant-tx.host';

/**
 * Global so every feature module can `@UseGuards(SessionAuthGuard,
 * AccountMemberGuard, RolesGuard)` and inject `TenantTxHost` without
 * re-declaring providers. A provider only declared in AppModule (not
 * exported/global) is invisible to sibling-imported feature modules — that's
 * what broke InvitesService (confirmed by a runtime boot failure, not
 * something tsc/lint catch) when TenantTxHost lived there instead of here.
 *
 * SessionAuthGuard resolves the 'session' Passport strategy registered by
 * AuthModule — both must be imported in AppModule. The two other guards get
 * their repositories from DataSource directly (see their own files) instead
 * of TypeOrmModule.forFeature() — that's what makes them safely global.
 */
@Global()
@Module({
  providers: [SessionAuthGuard, AccountMemberGuard, RolesGuard, TenantTxHost],
  exports: [SessionAuthGuard, AccountMemberGuard, RolesGuard, TenantTxHost],
})
export class CommonModule {}

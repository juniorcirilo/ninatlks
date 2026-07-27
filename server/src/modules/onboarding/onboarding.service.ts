import { Injectable, Scope } from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';
import { OrgOnboardingState } from '../../database/entities/accounts/org_onboarding_state.entity';

const NEXT: Record<string, string> = {
  welcome: 'empresa',
  empresa: 'elevenlabs',
  elevenlabs: 'twilio',
  twilio: 'deepgram',
  deepgram: 'evolution',
  evolution: 'agente',
  agente: 'numero',
  numero: 'done',
  done: 'done',
};

/** Ported from src/lib/onboarding.ts. */
@Injectable({ scope: Scope.REQUEST })
export class OnboardingService {
  constructor(private readonly tx: TenantTxHost) {}

  async getState(accountId: string): Promise<OrgOnboardingState | null> {
    return this.tx.manager.findOne(OrgOnboardingState, {
      where: { accountId },
    });
  }

  async advanceStep(
    accountId: string,
    step: string,
    payload?: Record<string, unknown>,
  ): Promise<{ nextStep: string }> {
    const cur = await this.tx.manager.findOne(OrgOnboardingState, {
      where: { accountId },
    });
    const completed = new Set<string>(
      (cur?.completedSteps as string[] | undefined) ?? [],
    );
    completed.add(step);
    const metadata = { ...((cur?.metadata as Record<string, unknown>) ?? {}) };
    if (payload && Object.keys(payload).length) {
      metadata[step] = {
        ...(metadata[step] ?? {}),
        ...payload,
      };
    }

    const next = NEXT[step];
    const completedAt =
      next === 'done' ? new Date() : (cur?.completedAt ?? null);

    await this.tx.manager.query(
      `INSERT INTO org_onboarding_state (account_id, current_step, completed_steps, metadata, completed_at, started_at)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, now())
       ON CONFLICT (account_id) DO UPDATE SET
         current_step = EXCLUDED.current_step,
         completed_steps = EXCLUDED.completed_steps,
         metadata = EXCLUDED.metadata,
         completed_at = EXCLUDED.completed_at`,
      [
        accountId,
        next,
        JSON.stringify(Array.from(completed)),
        JSON.stringify(metadata),
        completedAt,
      ],
    );

    return { nextStep: next };
  }

  async gotoStep(accountId: string, step: string): Promise<void> {
    await this.tx.manager.query(
      `INSERT INTO org_onboarding_state (account_id, current_step, started_at)
       VALUES ($1, $2, now())
       ON CONFLICT (account_id) DO UPDATE SET current_step = EXCLUDED.current_step`,
      [accountId, step],
    );
  }

  async skip(accountId: string): Promise<void> {
    const cur = await this.tx.manager.findOne(OrgOnboardingState, {
      where: { accountId },
    });
    const metadata = {
      ...((cur?.metadata as Record<string, unknown>) ?? {}),
      last_skipped_at: new Date().toISOString(),
    };
    await this.tx.manager.query(
      `INSERT INTO org_onboarding_state (account_id, metadata, started_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (account_id) DO UPDATE SET metadata = EXCLUDED.metadata`,
      [accountId, JSON.stringify(metadata)],
    );
  }

  async dismissChecklist(accountId: string): Promise<void> {
    const cur = await this.tx.manager.findOne(OrgOnboardingState, {
      where: { accountId },
    });
    const metadata = {
      ...((cur?.metadata as Record<string, unknown>) ?? {}),
      checklist_dismissed: true,
    };
    await this.tx.manager.query(
      `INSERT INTO org_onboarding_state (account_id, metadata, started_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (account_id) DO UPDATE SET metadata = EXCLUDED.metadata`,
      [accountId, JSON.stringify(metadata)],
    );
  }

  async dismiss(accountId: string): Promise<void> {
    await this.tx.manager.query(`SELECT public.onboarding_dismiss($1)`, [
      accountId,
    ]);
  }

  async reopen(accountId: string): Promise<void> {
    await this.tx.manager.query(`SELECT public.onboarding_reopen($1)`, [
      accountId,
    ]);
  }

  async recordHealthCheck(accountId: string, report: unknown): Promise<void> {
    await this.tx.manager.query(
      `INSERT INTO org_onboarding_state (account_id, health_check_results, health_check_at, started_at)
       VALUES ($1, $2::jsonb, now(), now())
       ON CONFLICT (account_id) DO UPDATE SET
         health_check_results = EXCLUDED.health_check_results,
         health_check_at = EXCLUDED.health_check_at`,
      [accountId, JSON.stringify(report)],
    );
  }
}

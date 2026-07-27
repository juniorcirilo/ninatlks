import { Injectable, Scope } from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';
import { AgentPersonas } from '../../database/entities/personas/agent_personas.entity';
import { AgentPersonaDeployments } from '../../database/entities/personas/agent_persona_deployments.entity';

@Injectable({ scope: Scope.REQUEST })
export class PersonasService {
  constructor(private readonly tx: TenantTxHost) {}

  async list(accountId: string) {
    return this.tx.manager.find(AgentPersonas, {
      where: { accountId },
      order: { updatedAt: 'DESC' },
    });
  }

  async create(params: {
    accountId: string;
    name: string;
    description?: string | null;
    sourceUserId?: string | null;
  }) {
    const persona = this.tx.manager.create(AgentPersonas, {
      accountId: params.accountId,
      name: params.name,
      description: params.description ?? null,
      sourceUserId: params.sourceUserId ?? null,
      status: 'active',
    });
    return this.tx.manager.save(AgentPersonas, persona);
  }

  async update(accountId: string, id: string, updates: Partial<AgentPersonas>) {
    await this.tx.manager
      .createQueryBuilder()
      .update(AgentPersonas)
      // TypeORM's QueryDeepPartialEntity typing for jsonb columns (config,
      // voiceConfig, turnConfig, ttsConfig: Record<string, unknown>) doesn't
      // structurally match a plain Partial<Entity> — these values are
      // already validated by UpdatePersonaDto, so the cast is safe.
      .set(updates as Record<string, unknown>)
      .where('id = :id AND account_id = :accountId', { id, accountId })
      .execute();
    return this.tx.manager.findOneOrFail(AgentPersonas, {
      where: { id, accountId },
    });
  }

  async remove(accountId: string, id: string) {
    await this.tx.manager
      .createQueryBuilder()
      .delete()
      .from(AgentPersonas)
      .where('id = :id AND account_id = :accountId', { id, accountId })
      .execute();
  }

  async listDeployments(accountId: string, personaId: string) {
    return this.tx.manager.find(AgentPersonaDeployments, {
      where: { accountId, personaId },
    });
  }

  async removeDeployment(accountId: string, id: string) {
    await this.tx.manager
      .createQueryBuilder()
      .delete()
      .from(AgentPersonaDeployments)
      .where('id = :id AND account_id = :accountId', { id, accountId })
      .execute();
  }

  async findActiveDeploymentForInbox(accountId: string, inboxId: string) {
    const rows = await this.tx.manager.query<
      (AgentPersonaDeployments & {
        persona_name: string;
        persona_status: string;
      })[]
    >(
      `SELECT d.*, p.name AS persona_name, p.status AS persona_status
       FROM public.agent_persona_deployments d
       JOIN public.agent_personas p ON p.id = d.persona_id
       WHERE d.account_id = $1 AND d.inbox_id = $2 AND d.enabled = true AND p.status = 'active'
       ORDER BY d.updated_at DESC
       LIMIT 1`,
      [accountId, inboxId],
    );
    return rows[0] ?? null;
  }

  async deploy(params: {
    accountId: string;
    personaId: string;
    inboxId: string;
    enabled?: boolean;
    mode?: string;
    autonomy?: string;
    confidenceThreshold?: number;
    dailyMessageBudget?: number;
  }) {
    await this.tx.manager.query(
      `INSERT INTO public.agent_persona_deployments
         (persona_id, account_id, inbox_id, enabled, mode, autonomy, confidence_threshold, daily_message_budget)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (persona_id, inbox_id) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         mode = EXCLUDED.mode,
         autonomy = EXCLUDED.autonomy,
         confidence_threshold = EXCLUDED.confidence_threshold,
         daily_message_budget = EXCLUDED.daily_message_budget,
         updated_at = now()`,
      [
        params.personaId,
        params.accountId,
        params.inboxId,
        params.enabled ?? true,
        params.mode ?? 'always',
        params.autonomy ?? 'auto',
        params.confidenceThreshold ?? 0.4,
        params.dailyMessageBudget ?? 100,
      ],
    );
    return this.tx.manager.findOneOrFail(AgentPersonaDeployments, {
      where: {
        accountId: params.accountId,
        personaId: params.personaId,
        inboxId: params.inboxId,
      },
    });
  }

  async distill(accountId: string, personaId: string) {
    throw new Error('Persona distill not yet implemented on new backend');
  }

  async suggestReply(accountId: string, personaId: string, conversationId: string) {
    throw new Error('Persona suggest-reply not yet implemented on new backend');
  }

  async generatePrompt(accountId: string, personaId: string, body: { description: string; existingPrompt?: string; refine?: boolean }) {
    throw new Error('Persona generate-prompt not yet implemented on new backend');
  }
}

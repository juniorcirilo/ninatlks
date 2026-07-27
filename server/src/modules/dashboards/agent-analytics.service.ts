import { Injectable, Scope } from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';

export interface PersonaKpi {
  persona_id: string;
  name: string;
  kind: string;
  status: string;
  handoffs_out: number;
  meetings_scheduled: number;
  csat_avg: number | null;
  csat_count: number;
  csat_low_pct: number;
}

export interface AnalyticsResult {
  window_days: number;
  total_personas: number;
  total_handoffs: number;
  total_meetings: number;
  csat_avg_global: number | null;
  per_persona: PersonaKpi[];
}

/** Ported from src/lib/agent-analytics.functions.ts. */
@Injectable({ scope: Scope.REQUEST })
export class AgentAnalyticsService {
  constructor(private readonly tx: TenantTxHost) {}

  async get(accountId: string, windowDays = 30): Promise<AnalyticsResult> {
    const since = new Date(Date.now() - windowDays * 86400_000);

    const [personas, handoffs, meetings, csat] = await Promise.all([
      this.tx.manager.query<
        {
          id: string;
          name: string;
          status: string;
          kind: string | null;
          is_sdr: boolean;
        }[]
      >(
        `SELECT p.id, p.name, p.status,
                (SELECT r.kind FROM agent_roles r WHERE r.persona_id = p.id ORDER BY r.created_at LIMIT 1) AS kind,
                EXISTS(SELECT 1 FROM agent_roles r WHERE r.persona_id = p.id AND r.kind = 'sdr') AS is_sdr
         FROM agent_personas p WHERE p.account_id = $1`,
        [accountId],
      ),
      this.tx.manager.query<{ from_persona_id: string | null }[]>(
        `SELECT from_persona_id FROM agent_handoffs WHERE account_id = $1 AND created_at >= $2`,
        [accountId, since],
      ),
      this.tx.manager.query<{ id: string }[]>(
        `SELECT id FROM scheduled_meetings WHERE account_id = $1 AND created_at >= $2`,
        [accountId, since],
      ),
      this.tx.manager.query<
        {
          rating: number;
          handler_type: string | null;
          handler_id: string | null;
        }[]
      >(
        `SELECT rating, handler_type, handler_id FROM csat_surveys
         WHERE account_id = $1 AND sent_at >= $2 AND rating IS NOT NULL`,
        [accountId, since],
      ),
    ]);

    const handoffsByPersona = new Map<string, number>();
    for (const h of handoffs) {
      if (!h.from_persona_id) continue;
      handoffsByPersona.set(
        h.from_persona_id,
        (handoffsByPersona.get(h.from_persona_id) ?? 0) + 1,
      );
    }

    const csatByPersona = new Map<string, number[]>();
    let csatGlobalSum = 0;
    let csatGlobalN = 0;
    for (const c of csat) {
      csatGlobalSum += c.rating;
      csatGlobalN += 1;
      if (c.handler_id) {
        const arr = csatByPersona.get(c.handler_id) ?? [];
        arr.push(c.rating);
        csatByPersona.set(c.handler_id, arr);
      }
    }

    const meetingsTotal = meetings.length;
    const sdrPersonas = personas.filter((p) => p.is_sdr);
    const meetingsPerSdr =
      sdrPersonas.length > 0
        ? Math.round(meetingsTotal / sdrPersonas.length)
        : 0;

    const perPersona: PersonaKpi[] = personas.map((p) => {
      const ratings = csatByPersona.get(p.id) ?? [];
      const sum = ratings.reduce((a, b) => a + b, 0);
      return {
        persona_id: p.id,
        name: p.name,
        kind: p.kind ?? '—',
        status: p.status,
        handoffs_out: handoffsByPersona.get(p.id) ?? 0,
        meetings_scheduled: p.is_sdr ? meetingsPerSdr : 0,
        csat_avg:
          ratings.length > 0 ? Number((sum / ratings.length).toFixed(2)) : null,
        csat_count: ratings.length,
        csat_low_pct:
          ratings.length > 0
            ? Number(
                (
                  (ratings.filter((r) => r <= 2).length / ratings.length) *
                  100
                ).toFixed(1),
              )
            : 0,
      };
    });

    return {
      window_days: windowDays,
      total_personas: personas.length,
      total_handoffs: handoffs.length,
      total_meetings: meetingsTotal,
      csat_avg_global:
        csatGlobalN > 0
          ? Number((csatGlobalSum / csatGlobalN).toFixed(2))
          : null,
      per_persona: perPersona.sort(
        (a, b) =>
          b.handoffs_out + b.csat_count - (a.handoffs_out + a.csat_count),
      ),
    };
  }
}

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
  calls_total: number;
  calls_completed: number;
  calls_avg_duration_sec: number;
}

export interface AnalyticsResult {
  window_days: number;
  total_personas: number;
  total_handoffs: number;
  total_meetings: number;
  total_calls: number;
  total_calls_completed: number;
  csat_avg_global: number | null;
  per_persona: PersonaKpi[];
}

/** Ported from src/lib/agent-analytics.functions.ts. */
@Injectable({ scope: Scope.REQUEST })
export class AgentAnalyticsService {
  constructor(private readonly tx: TenantTxHost) {}

  async get(accountId: string, windowDays = 30): Promise<AnalyticsResult> {
    const since = new Date(Date.now() - windowDays * 86400_000);

    const [personas, handoffs, meetings, meetingsByPersonaRows, csat, callsByPersonaRows] =
      await Promise.all([
      this.tx.manager.query<
        {
          id: string;
          name: string;
          status: string;
          kind: string | null;
        }[]
      >(
        `SELECT p.id, p.name, p.status,
                (SELECT r.kind FROM agent_roles r WHERE r.persona_id = p.id ORDER BY r.created_at LIMIT 1) AS kind
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
      this.tx.manager.query<{ persona_id: string; n: string }[]>(
        `SELECT vc.persona_id, COUNT(*) AS n
         FROM scheduled_meetings sm
         JOIN voice_calls vc ON vc.id = sm.sdr_call_id
         WHERE sm.account_id = $1 AND sm.created_at >= $2 AND vc.persona_id IS NOT NULL
         GROUP BY vc.persona_id`,
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
      this.tx.manager.query<
        { persona_id: string; total: string; completed: string; avg_duration: string }[]
      >(
        `SELECT persona_id,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status = 'completed') AS completed,
                COALESCE(AVG(duration_seconds) FILTER (WHERE status = 'completed'), 0) AS avg_duration
         FROM voice_calls
         WHERE account_id = $1 AND created_at >= $2 AND persona_id IS NOT NULL
         GROUP BY persona_id`,
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

    const meetingsByPersona = new Map<string, number>();
    for (const row of meetingsByPersonaRows) {
      meetingsByPersona.set(row.persona_id, Number(row.n));
    }

    const callsByPersona = new Map<
      string,
      { total: number; completed: number; avgDurationSec: number }
    >();
    let callsGlobalTotal = 0;
    let callsGlobalCompleted = 0;
    for (const row of callsByPersonaRows) {
      const total = Number(row.total);
      const completed = Number(row.completed);
      callsByPersona.set(row.persona_id, {
        total,
        completed,
        avgDurationSec: Math.round(Number(row.avg_duration)),
      });
      callsGlobalTotal += total;
      callsGlobalCompleted += completed;
    }

    const perPersona: PersonaKpi[] = personas.map((p) => {
      const ratings = csatByPersona.get(p.id) ?? [];
      const sum = ratings.reduce((a, b) => a + b, 0);
      const calls = callsByPersona.get(p.id);
      return {
        persona_id: p.id,
        name: p.name,
        kind: p.kind ?? '—',
        status: p.status,
        handoffs_out: handoffsByPersona.get(p.id) ?? 0,
        meetings_scheduled: meetingsByPersona.get(p.id) ?? 0,
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
        calls_total: calls?.total ?? 0,
        calls_completed: calls?.completed ?? 0,
        calls_avg_duration_sec: calls?.avgDurationSec ?? 0,
      };
    });

    return {
      window_days: windowDays,
      total_personas: personas.length,
      total_calls: callsGlobalTotal,
      total_calls_completed: callsGlobalCompleted,
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

import { Injectable, Scope } from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';

export interface SdrSnapshot {
  leads_total: number;
  leads_today: number;
  leads_week: number;
  calls_today: number;
  calls_week: number;
  avg_sentiment_week: number | null;
  positive_pct_week: number | null;
  meetings_upcoming: number;
  meetings_attended_week: number;
  meetings_no_show_week: number;
  attendance_rate_week: number | null;
  pipeline: Array<{
    stage_id: string;
    stage_name: string;
    color: string;
    count: number;
    is_won: boolean;
    is_lost: boolean;
  }>;
  upcoming_meetings: Array<{
    id: string;
    starts_at: string;
    invitee_name: string | null;
    invitee_phone: string | null;
    attendee_name: string | null;
    confirmed: boolean;
  }>;
}

interface PipelineGetResult {
  stages?: Array<{
    id: string;
    name: string;
    color: string;
    is_won?: boolean;
    is_lost?: boolean;
    leads?: unknown[];
  }>;
}

/** Ported from src/lib/dashboard-sdr.ts. */
@Injectable({ scope: Scope.REQUEST })
export class DashboardSdrService {
  constructor(private readonly tx: TenantTxHost) {}

  async snapshot(accountId: string): Promise<SdrSnapshot> {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const weekAgo = new Date(now.getTime() - 7 * 86400_000);
    const horizon7d = new Date(now.getTime() + 7 * 86400_000);

    const safe = async <T>(p: Promise<T>, fallback: T): Promise<T> => {
      try {
        return await p;
      } catch {
        return fallback;
      }
    };

    const [counts, sentimentRows, pipeline, upcoming] = await Promise.all([
      safe(
        this.tx.manager.query<
          {
            leads_total: string;
            leads_today: string;
            leads_week: string;
            calls_today: string;
            calls_week: string;
            meetings_upcoming: string;
            meetings_attended_week: string;
            meetings_no_show_week: string;
          }[]
        >(
          `SELECT
             (SELECT count(*) FROM contacts WHERE account_id = $1) AS leads_total,
             (SELECT count(*) FROM contacts WHERE account_id = $1 AND created_at >= $2) AS leads_today,
             (SELECT count(*) FROM contacts WHERE account_id = $1 AND created_at >= $3) AS leads_week,
             (SELECT count(*) FROM voice_calls WHERE account_id = $1 AND started_at >= $2) AS calls_today,
             (SELECT count(*) FROM voice_calls WHERE account_id = $1 AND started_at >= $3) AS calls_week,
             (SELECT count(*) FROM scheduled_meetings WHERE account_id = $1 AND status = 'scheduled' AND starts_at >= $5 AND starts_at < $4) AS meetings_upcoming,
             (SELECT count(*) FROM scheduled_meetings WHERE account_id = $1 AND status = 'attended' AND attended_at >= $3) AS meetings_attended_week,
             (SELECT count(*) FROM scheduled_meetings WHERE account_id = $1 AND status = 'no_show' AND detected_no_show_at >= $3) AS meetings_no_show_week`,
          [accountId, startOfDay, weekAgo, horizon7d, now],
        ),
        [
          {
            leads_total: '0',
            leads_today: '0',
            leads_week: '0',
            calls_today: '0',
            calls_week: '0',
            meetings_upcoming: '0',
            meetings_attended_week: '0',
            meetings_no_show_week: '0',
          },
        ],
      ),
      safe(
        this.tx.manager.query<
          { sentiment: { score?: number; aggregate?: string } | null }[]
        >(
          `SELECT sentiment FROM voice_calls
           WHERE account_id = $1 AND started_at >= $2 AND sentiment IS NOT NULL LIMIT 500`,
          [accountId, weekAgo],
        ),
        [],
      ),
      safe(this.fetchPipelineSnapshot(accountId), []),
      safe(this.fetchUpcomingMeetings(accountId), []),
    ]);

    const row = counts[0];

    let avgSentiment: number | null = null;
    let positivePct: number | null = null;
    if (sentimentRows.length > 0) {
      const scores = sentimentRows
        .map((r) => Number(r.sentiment?.score ?? 0))
        .filter((n) => !Number.isNaN(n));
      if (scores.length > 0) {
        avgSentiment = scores.reduce((s, n) => s + n, 0) / scores.length;
        const positives = sentimentRows.filter(
          (r) => r.sentiment?.aggregate === 'positive',
        ).length;
        positivePct = (positives / sentimentRows.length) * 100;
      }
    }

    const attended = parseInt(row.meetings_attended_week, 10);
    const noShow = parseInt(row.meetings_no_show_week, 10);
    const attendanceRate =
      attended + noShow > 0 ? (attended / (attended + noShow)) * 100 : null;

    return {
      leads_total: parseInt(row.leads_total, 10),
      leads_today: parseInt(row.leads_today, 10),
      leads_week: parseInt(row.leads_week, 10),
      calls_today: parseInt(row.calls_today, 10),
      calls_week: parseInt(row.calls_week, 10),
      avg_sentiment_week: avgSentiment,
      positive_pct_week: positivePct,
      meetings_upcoming: parseInt(row.meetings_upcoming, 10),
      meetings_attended_week: attended,
      meetings_no_show_week: noShow,
      attendance_rate_week: attendanceRate,
      pipeline,
      upcoming_meetings: upcoming,
    };
  }

  private async fetchPipelineSnapshot(
    accountId: string,
  ): Promise<SdrSnapshot['pipeline']> {
    const rows = await this.tx.manager.query<
      { pipeline_get: PipelineGetResult }[]
    >(`SELECT public.pipeline_get($1) AS pipeline_get`, [accountId]);
    const stages = rows[0]?.pipeline_get?.stages ?? [];
    return stages.map((s) => ({
      stage_id: s.id,
      stage_name: s.name,
      color: s.color,
      count: Array.isArray(s.leads) ? s.leads.length : 0,
      is_won: !!s.is_won,
      is_lost: !!s.is_lost,
    }));
  }

  private async fetchUpcomingMeetings(
    accountId: string,
  ): Promise<SdrSnapshot['upcoming_meetings']> {
    const now = new Date();
    const horizon = new Date(now.getTime() + 7 * 86400_000);
    const rows = await this.tx.manager.query<
      {
        id: string;
        starts_at: string;
        invitee_name: string | null;
        invitee_phone: string | null;
        attendee_user_id: string | null;
        confirmed_at: string | null;
      }[]
    >(
      `SELECT id, starts_at, invitee_name, invitee_phone, attendee_user_id, confirmed_at
       FROM scheduled_meetings
       WHERE account_id = $1 AND status = 'scheduled' AND starts_at >= $2 AND starts_at < $3
       ORDER BY starts_at LIMIT 3`,
      [accountId, now, horizon],
    );
    if (rows.length === 0) return [];

    const userIds = Array.from(
      new Set(
        rows.map((r) => r.attendee_user_id).filter((v): v is string => !!v),
      ),
    );
    const profiles = new Map<string, string | null>();
    if (userIds.length > 0) {
      const profs = await this.tx.manager.query<
        {
          id: string;
          display_name: string | null;
          name: string | null;
          email: string;
        }[]
      >(
        `SELECT id, display_name, name, email FROM profiles WHERE id = ANY($1)`,
        [userIds],
      );
      for (const p of profs)
        profiles.set(p.id, p.display_name ?? p.name ?? p.email ?? null);
    }

    return rows.map((r) => ({
      id: r.id,
      starts_at: r.starts_at,
      invitee_name: r.invitee_name,
      invitee_phone: r.invitee_phone,
      attendee_name: r.attendee_user_id
        ? (profiles.get(r.attendee_user_id) ?? null)
        : null,
      confirmed: !!r.confirmed_at,
    }));
  }
}

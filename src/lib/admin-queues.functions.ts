// Server functions para o Dashboard de Filas (Fase 1 — Modernização da Base).
//
// Lê as filas críticas com SQL agregado em uma única chamada por widget,
// evitando N+1 e mantendo o painel responsivo mesmo com milhões de linhas.
//
// "Envio de mensagens" (message_dispatch_queue) e "Workflows" (workflow_runs)
// foram substituídos por "Discagem de campanha" (voice_campaign_contacts) e
// "Listas operacionais" (agent_inbound_sources): as duas tabelas antigas
// pertencem ao pipeline de SMS/WhatsApp e ao motor de workflow, nenhum dos
// dois portado neste app (ver server/src/modules/jobs/jobs.module.ts) — não
// tinham nenhum gravador e ficavam sempre zeradas. O pipeline real de
// campanha/lista é voice-campaign-dispatch.processor.ts e
// agent-source-poll.processor.ts.

import { createServerFn } from "@tanstack/react-start";
import { requireSessionAuth, type SessionMembership, type SessionUser } from "@/lib/session-middleware";
import { query, getOne } from "@/lib/db";

// 'escalated' é status terminal (contato finalizado como transferido) — NÃO é
// em-voo. Incluí-lo aqui inflava o contador "em execução" mesmo após a ligação
// ter encerrado e a IA ter classificado o contato.
const IN_FLIGHT_STATUSES = ["placed", "ringing", "connected"];

/**
 * Sem isto, qualquer usuário autenticado (de qualquer conta) via
 * requireSessionAuth via as filas de TODAS as contas do sistema — nenhuma
 * das queries abaixo filtrava por account_id nem checava papel de admin.
 * "admin-filas" no nome da rota sugeria uma tela restrita, mas nada
 * aplicava isso.
 */
function requireAccountAdmin(context: {
  user: SessionUser | null;
  membership: SessionMembership | null;
  accountId: string | null;
}): string {
  if (!context.accountId) throw new Error("Usuário sem conta associada.");
  if (!context.user?.isSuperAdmin && context.membership?.role !== "admin") {
    throw new Error("Acesso restrito a administradores da conta.");
  }
  return context.accountId;
}

export interface QueueSummary {
  campaignDispatch: {
    pending: number;
    failed: number;
    inFlight: number;
    oldestPendingAt: string | null;
    avgAttempts: number;
  };
  followUps: {
    pending: number;
    failed: number;
    completed24h: number;
    nextDueAt: string | null;
  };
  sources: {
    due: number;
    active: number;
    failedLastRun: number;
    lastSyncAt: string | null;
  };
  webhooks: {
    failed24h: number;
    delivered24h: number;
  };
}

export interface FailedCampaignContactRow {
  id: number;
  campaignId: string;
  campaignName: string;
  phoneNumber: string;
  status: string;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  createdAt: string;
}

/**
 * Retrato ao vivo de uma campanha: quantos números tem a lista, quantos já
 * saíram da fila e como terminaram. `positive`/`negative` vêm de
 * voice_calls.outcome_category (classificação por IA pós-ligação, só existe
 * quando a chamada foi atendida e transcrita) — é a métrica que separa
 * "atendeu" de "atendeu e topou".
 */
export interface CampaignQueueRow {
  id: string;
  name: string;
  kind: string | null;
  status: string;
  totalContacts: number;
  queued: number;
  inFlight: number;
  connected: number;
  escalated: number;
  voicemail: number;
  failed: number;
  canceled: number;
  positive: number;
  negative: number;
  startedAt: string | null;
  nextAttemptAt: string | null;
}

export interface EscalatedCallRow {
  id: number;
  campaignId: string;
  campaignName: string;
  phoneNumber: string;
  transferTarget: string | null;
  escalationReason: string | null;
  attempts: number;
  updatedAt: string;
}

export const listActiveCampaignsQueue = createServerFn({ method: "GET" })
  .middleware([requireSessionAuth])
  .handler(async ({ context }): Promise<CampaignQueueRow[]> => {
    const accountId = requireAccountAdmin(context);
    const rows = await query<Record<string, unknown>>(
      `SELECT vc.id, vc.name, vc.campaign_kind, vc.status, vc.started_at, vc.total_contacts,
              COALESCE(agg.queued, 0)::int AS queued,
              COALESCE(agg.in_flight, 0)::int AS in_flight,
              COALESCE(agg.connected, 0)::int AS connected,
              COALESCE(agg.voicemail, 0)::int AS voicemail,
              COALESCE(agg.failed, 0)::int AS failed,
              COALESCE(agg.canceled, 0)::int AS canceled,
              COALESCE(agg.positive, 0)::int AS positive,
              COALESCE(agg.negative, 0)::int AS negative,
              agg.next_attempt_at
       FROM voice_campaigns vc
       LEFT JOIN LATERAL (
         SELECT
           count(*) FILTER (WHERE vcc.status = 'queued') AS queued,
           count(*) FILTER (WHERE vcc.status = ANY($1)) AS in_flight,
           count(*) FILTER (WHERE vcc.status = 'completed') AS connected,
           count(*) FILTER (WHERE vcc.status = 'escalated') AS escalated,
           count(*) FILTER (WHERE vcc.status = 'voicemail') AS voicemail,
           count(*) FILTER (WHERE vcc.status = 'failed') AS failed,
           count(*) FILTER (WHERE vcc.status = 'canceled') AS canceled,
           count(*) FILTER (WHERE vc2.outcome_category = 'interested') AS positive,
           count(*) FILTER (WHERE vc2.outcome_category = 'not_interested') AS negative,
           min(vcc.dispatch_after) FILTER (WHERE vcc.status = 'queued') AS next_attempt_at
         FROM voice_campaign_contacts vcc
         LEFT JOIN voice_calls vc2 ON vc2.id = vcc.voice_call_id
         WHERE vcc.campaign_id = vc.id
       ) agg ON true
       WHERE vc.status IN ('running', 'paused', 'scheduled') AND vc.account_id = $2
       ORDER BY (vc.status = 'running') DESC, vc.started_at DESC NULLS LAST, vc.created_at DESC
       LIMIT 12`,
      [IN_FLIGHT_STATUSES, accountId],
    );
    return (rows ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      name: r.name as string,
      kind: (r.campaign_kind as string | null) ?? null,
      status: r.status as string,
      totalContacts: Number(r.total_contacts ?? 0),
      queued: Number(r.queued ?? 0),
      inFlight: Number(r.in_flight ?? 0),
      connected: Number(r.connected ?? 0),
      escalated: Number(r.escalated ?? 0),
      voicemail: Number(r.voicemail ?? 0),
      failed: Number(r.failed ?? 0),
      canceled: Number(r.canceled ?? 0),
      positive: Number(r.positive ?? 0),
      negative: Number(r.negative ?? 0),
      startedAt: (r.started_at as string | null) ?? null,
      nextAttemptAt: (r.next_attempt_at as string | null) ?? null,
    }));
  });

export const getQueueSummary = createServerFn({ method: "GET" })
  .middleware([requireSessionAuth])
  .handler(async ({ context }) => {
    const accountId = requireAccountAdmin(context);
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [
      campaignPending,
      campaignFailed,
      campaignInFlight,
      campaignOldest,
      campaignAttempts,
      fuPending,
      fuFailed,
      fuDone,
      fuNext,
      srcDue,
      srcActive,
      srcFailed,
      srcLastSync,
      whFail,
      whOk,
    ] = await Promise.all([
      query<{ n: number }>(
        `SELECT count(*)::int AS n FROM voice_campaign_contacts WHERE status = $1 AND account_id = $2`,
        ["queued", accountId],
      ),
      query<{ n: number }>(
        `SELECT count(*)::int AS n FROM voice_campaign_contacts WHERE status = $1 AND account_id = $2`,
        ["failed", accountId],
      ),
      query<{ n: number }>(
        `SELECT count(*)::int AS n FROM voice_campaign_contacts WHERE status = ANY($1) AND account_id = $2`,
        [IN_FLIGHT_STATUSES, accountId],
      ),
      getOne<{ created_at: string }>(
        `SELECT created_at FROM voice_campaign_contacts WHERE status = $1 AND account_id = $2 ORDER BY created_at LIMIT 1`,
        ["queued", accountId],
      ),
      query<{ attempts: number }>(
        `SELECT attempts FROM voice_campaign_contacts WHERE status = $1 AND account_id = $2 LIMIT 1000`,
        ["queued", accountId],
      ),
      query<{ n: number }>(
        `SELECT count(*)::int AS n FROM follow_up_executions WHERE status = $1 AND account_id = $2`,
        ["pending", accountId],
      ),
      query<{ n: number }>(
        `SELECT count(*)::int AS n FROM follow_up_executions WHERE status = $1 AND account_id = $2`,
        ["failed", accountId],
      ),
      query<{ n: number }>(
        `SELECT count(*)::int AS n FROM follow_up_executions WHERE status = $1 AND updated_at >= $2 AND account_id = $3`,
        ["completed", since24h, accountId],
      ),
      getOne<{ next_run_at: string }>(
        `SELECT next_run_at FROM follow_up_executions WHERE status = $1 AND account_id = $2 ORDER BY next_run_at LIMIT 1`,
        ["pending", accountId],
      ),
      query<{ n: number }>(
        `SELECT count(*)::int AS n FROM agent_inbound_sources
         WHERE active AND schedule_minutes IS NOT NULL AND running_since IS NULL
           AND (last_run_at IS NULL OR last_run_at < now() - make_interval(mins => schedule_minutes))
           AND account_id = $1`,
        [accountId],
      ),
      query<{ n: number }>(
        `SELECT count(*)::int AS n FROM agent_inbound_sources WHERE active AND account_id = $1`,
        [accountId],
      ),
      query<{ n: number }>(
        `SELECT count(*)::int AS n FROM agent_inbound_sources WHERE last_status = $1 AND account_id = $2`,
        ["erro", accountId],
      ),
      getOne<{ last_run_at: string }>(
        `SELECT last_run_at FROM agent_inbound_sources WHERE last_run_at IS NOT NULL AND account_id = $1 ORDER BY last_run_at DESC LIMIT 1`,
        [accountId],
      ),
      query<{ n: number }>(
        `SELECT count(*)::int AS n FROM webhook_deliveries WHERE http_status >= $1 AND created_at >= $2 AND account_id = $3`,
        [400, since24h, accountId],
      ),
      query<{ n: number }>(
        `SELECT count(*)::int AS n FROM webhook_deliveries WHERE http_status < $1 AND http_status >= $2 AND created_at >= $3 AND account_id = $4`,
        [400, 200, since24h, accountId],
      ),
    ]);

    const attemptsArr = campaignAttempts;
    const avgAttempts = attemptsArr.length
      ? attemptsArr.reduce((s, r) => s + (r.attempts ?? 0), 0) / attemptsArr.length
      : 0;

    return {
      campaignDispatch: {
        pending: campaignPending[0]?.n ?? 0,
        failed: campaignFailed[0]?.n ?? 0,
        inFlight: campaignInFlight[0]?.n ?? 0,
        oldestPendingAt: campaignOldest?.created_at ?? null,
        avgAttempts: Number(avgAttempts.toFixed(2)),
      },
      followUps: {
        pending: fuPending[0]?.n ?? 0,
        failed: fuFailed[0]?.n ?? 0,
        completed24h: fuDone[0]?.n ?? 0,
        nextDueAt: fuNext?.next_run_at ?? null,
      },
      sources: {
        due: srcDue[0]?.n ?? 0,
        active: srcActive[0]?.n ?? 0,
        failedLastRun: srcFailed[0]?.n ?? 0,
        lastSyncAt: srcLastSync?.last_run_at ?? null,
      },
      webhooks: {
        failed24h: whFail[0]?.n ?? 0,
        delivered24h: whOk[0]?.n ?? 0,
      },
    };
  });

export const listEscalatedCalls = createServerFn({ method: "GET" })
  .middleware([requireSessionAuth])
  .handler(async ({ context }): Promise<EscalatedCallRow[]> => {
    const accountId = requireAccountAdmin(context);
    const rows = await query<Record<string, unknown>>(
      `SELECT vcc.id, vcc.campaign_id, vc.name AS campaign_name, vcc.phone_number,
              vcc.transfer_target, vcc.escalation_reason, vcc.attempts, vcc.updated_at
       FROM voice_campaign_contacts vcc
       JOIN voice_campaigns vc ON vc.id = vcc.campaign_id
       WHERE vcc.status = 'escalated' AND vcc.account_id = $1
       ORDER BY vcc.updated_at DESC
       LIMIT 50`,
      [accountId],
    );
    return (rows ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as number,
      campaignId: r.campaign_id as string,
      campaignName: r.campaign_name as string,
      phoneNumber: r.phone_number as string,
      transferTarget: (r.transfer_target as string | null) ?? null,
      escalationReason: (r.escalation_reason as string | null) ?? null,
      attempts: r.attempts as number,
      updatedAt: r.updated_at as string,
    }));
  });

export const listFailedDispatch = createServerFn({ method: "GET" })
  .middleware([requireSessionAuth])
  .handler(async ({ context }): Promise<FailedCampaignContactRow[]> => {
    const accountId = requireAccountAdmin(context);
    const rows = await query<Record<string, unknown>>(
      `SELECT vcc.id, vcc.campaign_id, vc.name AS campaign_name, vcc.phone_number,
              vcc.status, vcc.attempts, vcc.dispatch_after, vcc.last_error, vcc.created_at
       FROM voice_campaign_contacts vcc
       JOIN voice_campaigns vc ON vc.id = vcc.campaign_id
       WHERE vcc.status = ANY($1) AND vcc.account_id = $2
       ORDER BY vcc.created_at DESC
       LIMIT 50`,
      [["failed", "queued"], accountId],
    );
    return (rows ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as number,
      campaignId: r.campaign_id as string,
      campaignName: r.campaign_name as string,
      phoneNumber: r.phone_number as string,
      status: r.status as string,
      attempts: r.attempts as number,
      nextAttemptAt: (r.dispatch_after as string | null) ?? null,
      lastError: (r.last_error as string | null) ?? null,
      createdAt: r.created_at as string,
    }));
  });

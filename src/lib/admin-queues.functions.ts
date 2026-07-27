// Server functions para o Dashboard de Filas (Fase 1 — Modernização da Base).
//
// Lê 3 filas críticas com SQL agregado em uma única chamada por widget,
// evitando N+1 e mantendo o painel responsivo mesmo com milhões de linhas.

import { createServerFn } from "@tanstack/react-start";
import { requireSessionAuth } from "@/lib/session-middleware";
import { query, getOne } from "@/lib/db";

export interface QueueSummary {
  dispatch: {
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
  workflows: {
    pending: number;
    failed24h: number;
    succeeded24h: number;
    avgDurationMs: number | null;
  };
  webhooks: {
    failed24h: number;
    delivered24h: number;
  };
}

export interface DispatchQueueRow {
  id: number;
  conversationId: string;
  channelType: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  createdAt: string;
}

export const getQueueSummary = createServerFn({ method: "GET" })
  .middleware([requireSessionAuth])
  .handler(async () => {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [
      dispatchPending,
      dispatchFailed,
      dispatchInFlight,
      dispatchOldest,
      dispatchAttempts,
      fuPending,
      fuFailed,
      fuDone,
      fuNext,
      wfPending,
      wfFailed,
      wfOk,
      wfDur,
      whFail,
      whOk,
    ] = await Promise.all([
      query<{ n: number }>(
        `SELECT count(*)::int AS n FROM message_dispatch_queue WHERE status = $1`,
        ["pending"],
      ),
      query<{ n: number }>(
        `SELECT count(*)::int AS n FROM message_dispatch_queue WHERE status = $1`,
        ["failed"],
      ),
      query<{ n: number }>(
        `SELECT count(*)::int AS n FROM message_dispatch_queue WHERE status = $1`,
        ["in_flight"],
      ),
      getOne<{ created_at: string }>(
        `SELECT created_at FROM message_dispatch_queue WHERE status = $1 ORDER BY created_at LIMIT 1`,
        ["pending"],
      ),
      query<{ attempts: number }>(
        `SELECT attempts FROM message_dispatch_queue WHERE status = $1 LIMIT 1000`,
        ["pending"],
      ),
      query<{ n: number }>(
        `SELECT count(*)::int AS n FROM follow_up_executions WHERE status = $1`,
        ["pending"],
      ),
      query<{ n: number }>(
        `SELECT count(*)::int AS n FROM follow_up_executions WHERE status = $1`,
        ["failed"],
      ),
      query<{ n: number }>(
        `SELECT count(*)::int AS n FROM follow_up_executions WHERE status = $1 AND updated_at >= $2`,
        ["completed", since24h],
      ),
      getOne<{ next_run_at: string }>(
        `SELECT next_run_at FROM follow_up_executions WHERE status = $1 ORDER BY next_run_at LIMIT 1`,
        ["pending"],
      ),
      query<{ n: number }>(
        `SELECT count(*)::int AS n FROM workflow_runs WHERE status = $1`,
        ["pending"],
      ),
      query<{ n: number }>(
        `SELECT count(*)::int AS n FROM workflow_runs WHERE status = $1 AND created_at >= $2`,
        ["failed", since24h],
      ),
      query<{ n: number }>(
        `SELECT count(*)::int AS n FROM workflow_runs WHERE status = $1 AND created_at >= $2`,
        ["succeeded", since24h],
      ),
      query<{ duration_ms: number | null }>(
        `SELECT duration_ms FROM workflow_runs WHERE created_at >= $1 AND duration_ms IS NOT NULL LIMIT 500`,
        [since24h],
      ),
      query<{ n: number }>(
        `SELECT count(*)::int AS n FROM webhook_deliveries WHERE http_status >= $1 AND created_at >= $2`,
        [400, since24h],
      ),
      query<{ n: number }>(
        `SELECT count(*)::int AS n FROM webhook_deliveries WHERE http_status < $1 AND http_status >= $2 AND created_at >= $3`,
        [400, 200, since24h],
      ),
    ]);

    const attemptsArr = dispatchAttempts;
    const avgAttempts = attemptsArr.length
      ? attemptsArr.reduce((s, r) => s + (r.attempts ?? 0), 0) / attemptsArr.length
      : 0;
    const durArr = wfDur;
    const avgDur = durArr.length
      ? Math.round(durArr.reduce((s, r) => s + (r.duration_ms ?? 0), 0) / durArr.length)
      : null;

    return {
      dispatch: {
        pending: dispatchPending[0]?.n ?? 0,
        failed: dispatchFailed[0]?.n ?? 0,
        inFlight: dispatchInFlight[0]?.n ?? 0,
        oldestPendingAt: dispatchOldest?.created_at ?? null,
        avgAttempts: Number(avgAttempts.toFixed(2)),
      },
      followUps: {
        pending: fuPending[0]?.n ?? 0,
        failed: fuFailed[0]?.n ?? 0,
        completed24h: fuDone[0]?.n ?? 0,
        nextDueAt: fuNext?.next_run_at ?? null,
      },
      workflows: {
        pending: wfPending[0]?.n ?? 0,
        failed24h: wfFailed[0]?.n ?? 0,
        succeeded24h: wfOk[0]?.n ?? 0,
        avgDurationMs: avgDur,
      },
      webhooks: {
        failed24h: whFail[0]?.n ?? 0,
        delivered24h: whOk[0]?.n ?? 0,
      },
    };
  });

export const listFailedDispatch = createServerFn({ method: "GET" })
  .middleware([requireSessionAuth])
  .handler(async (): Promise<DispatchQueueRow[]> => {
    const rows = await query<Record<string, unknown>>(
      `SELECT id, conversation_id, channel_type, status, attempts, max_attempts, next_attempt_at, last_error, created_at
       FROM message_dispatch_queue
       WHERE status = ANY($1)
       ORDER BY created_at DESC
       LIMIT 50`,
      [["failed", "pending"]],
    );
    return (rows ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as number,
      conversationId: r.conversation_id as string,
      channelType: r.channel_type as string,
      status: r.status as string,
      attempts: r.attempts as number,
      maxAttempts: r.max_attempts as number,
      nextAttemptAt: r.next_attempt_at as string,
      lastError: (r.last_error as string | null) ?? null,
      createdAt: r.created_at as string,
    }));
  });

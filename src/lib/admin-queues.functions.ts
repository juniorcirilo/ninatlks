// Server functions para o Dashboard de Filas (Fase 1 — Modernização da Base).
//
// Lê 3 filas críticas com SQL agregado em uma única chamada por widget,
// evitando N+1 e mantendo o painel responsivo mesmo com milhões de linhas.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<QueueSummary> => {
    const { supabase } = context;
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Cada bloco roda em paralelo — Supabase aceita até ~6 conexões simultâneas
    // por cliente JS sem problema.
    const [dispatchPending, dispatchFailed, dispatchInFlight, dispatchOldest,
           dispatchAttempts, fuPending, fuFailed, fuDone, fuNext,
           wfPending, wfFailed, wfOk, wfDur, whFail, whOk] = await Promise.all([
      supabase.from("message_dispatch_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("message_dispatch_queue").select("id", { count: "exact", head: true }).eq("status", "failed"),
      supabase.from("message_dispatch_queue").select("id", { count: "exact", head: true }).eq("status", "in_flight"),
      supabase.from("message_dispatch_queue").select("created_at").eq("status", "pending").order("created_at").limit(1).maybeSingle(),
      supabase.from("message_dispatch_queue").select("attempts").eq("status", "pending").limit(1000),
      supabase.from("follow_up_executions").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("follow_up_executions").select("id", { count: "exact", head: true }).eq("status", "failed"),
      supabase.from("follow_up_executions").select("id", { count: "exact", head: true }).eq("status", "completed").gte("updated_at", since24h),
      supabase.from("follow_up_executions").select("next_run_at").eq("status", "pending").order("next_run_at", { nullsFirst: true }).limit(1).maybeSingle(),
      supabase.from("workflow_runs").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("workflow_runs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", since24h),
      supabase.from("workflow_runs").select("id", { count: "exact", head: true }).eq("status", "succeeded").gte("created_at", since24h),
      supabase.from("workflow_runs").select("duration_ms").gte("created_at", since24h).not("duration_ms", "is", null).limit(500),
      supabase.from("webhook_deliveries").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", since24h),
      supabase.from("webhook_deliveries").select("id", { count: "exact", head: true }).eq("status", "delivered").gte("created_at", since24h),
    ]);

    const attemptsArr = (dispatchAttempts.data ?? []) as Array<{ attempts: number }>;
    const avgAttempts = attemptsArr.length
      ? attemptsArr.reduce((s, r) => s + (r.attempts ?? 0), 0) / attemptsArr.length
      : 0;
    const durArr = (wfDur.data ?? []) as Array<{ duration_ms: number | null }>;
    const avgDur = durArr.length
      ? Math.round(durArr.reduce((s, r) => s + (r.duration_ms ?? 0), 0) / durArr.length)
      : null;

    return {
      dispatch: {
        pending: dispatchPending.count ?? 0,
        failed: dispatchFailed.count ?? 0,
        inFlight: dispatchInFlight.count ?? 0,
        oldestPendingAt: (dispatchOldest.data as { created_at: string } | null)?.created_at ?? null,
        avgAttempts: Number(avgAttempts.toFixed(2)),
      },
      followUps: {
        pending: fuPending.count ?? 0,
        failed: fuFailed.count ?? 0,
        completed24h: fuDone.count ?? 0,
        nextDueAt: (fuNext.data as { next_run_at: string } | null)?.next_run_at ?? null,
      },
      workflows: {
        pending: wfPending.count ?? 0,
        failed24h: wfFailed.count ?? 0,
        succeeded24h: wfOk.count ?? 0,
        avgDurationMs: avgDur,
      },
      webhooks: {
        failed24h: whFail.count ?? 0,
        delivered24h: whOk.count ?? 0,
      },
    };
  });

export const listFailedDispatch = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DispatchQueueRow[]> => {
    const { data, error } = await context.supabase
      .from("message_dispatch_queue")
      .select("id, conversation_id, channel_type, status, attempts, max_attempts, next_attempt_at, last_error, created_at")
      .in("status", ["failed", "pending"])
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: Record<string, unknown>) => ({
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

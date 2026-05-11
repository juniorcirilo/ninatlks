// Structured logger + correlation ID propagation for edge functions.
//
// Every log line is a single JSON object on stdout so Lovable/Supabase log
// explorer can filter by correlation_id, account_id or severity with zero
// post-processing.
//
// Usage:
//   const log = loggerFor(req, { function: "channels-send", accountId });
//   log.info("dispatch ok", { providerMessageId });
//   log.error("dispatch failed", err, { type: body.type });
//
// Correlation ID is pulled from (in order): x-correlation-id header, x-nexus-
// correlation-id header, Sentry-style sentry-trace, or synthesized.

type Severity = "debug" | "info" | "warn" | "error";

export interface LogContext {
  function?: string;
  accountId?: string;
  conversationId?: string;
  messageId?: string;
  channelId?: string;
  contactId?: string;
  correlationId?: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, err?: unknown, extra?: Record<string, unknown>): void;
  error(msg: string, err?: unknown, extra?: Record<string, unknown>): void;
  child(extra: LogContext): Logger;
  /** Returns the correlation ID so callers can forward it. */
  correlationId(): string;
}

function synthId(): string {
  const rand = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `nex-${rand}`;
}

export function extractCorrelationId(req: Request): string {
  return (
    req.headers.get("x-correlation-id") ??
    req.headers.get("x-nexus-correlation-id") ??
    req.headers.get("x-request-id") ??
    synthId()
  );
}

function emit(severity: Severity, ctx: LogContext, msg: string, extra?: Record<string, unknown>) {
  const line = {
    timestamp: new Date().toISOString(),
    severity,
    message: msg,
    correlation_id: ctx.correlationId,
    function: ctx.function,
    account_id: ctx.accountId,
    conversation_id: ctx.conversationId,
    message_id: ctx.messageId,
    channel_id: ctx.channelId,
    contact_id: ctx.contactId,
    ...extra,
  };
  // Strip undefined
  for (const k of Object.keys(line) as (keyof typeof line)[]) {
    if (line[k] === undefined) delete line[k];
  }
  const out = JSON.stringify(line);
  if (severity === "error") console.error(out);
  else if (severity === "warn") console.warn(out);
  else console.log(out);
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      error_name: err.name,
      error_message: err.message,
      error_stack: err.stack?.split("\n").slice(0, 6).join(" | "),
    };
  }
  if (err && typeof err === "object") {
    return { error_detail: err };
  }
  return { error_detail: String(err) };
}

export function createLogger(ctx: LogContext = {}): Logger {
  const self: Logger = {
    debug: (m, extra) => emit("debug", ctx, m, extra),
    info: (m, extra) => emit("info", ctx, m, extra),
    warn: (m, err, extra) =>
      emit("warn", ctx, m, { ...(extra ?? {}), ...(err ? serializeError(err) : {}) }),
    error: (m, err, extra) =>
      emit("error", ctx, m, { ...(extra ?? {}), ...(err ? serializeError(err) : {}) }),
    child: (extra) => createLogger({ ...ctx, ...extra }),
    correlationId: () => String(ctx.correlationId ?? ""),
  };
  return self;
}

/**
 * Convenience: build a logger from a Request. Pulls correlation id out of
 * headers, mixes in any caller-provided context, and returns.
 */
export function loggerFor(req: Request, ctx: LogContext = {}): Logger {
  const correlationId = ctx.correlationId ?? extractCorrelationId(req);
  return createLogger({ ...ctx, correlationId });
}

/**
 * Standard CORS/response header set so every edge function can forward the
 * correlation_id back to the caller (UI reads it into sentry breadcrumb).
 */
export function corsWithCorrelation(log: Logger): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-correlation-id",
    "Access-Control-Expose-Headers": "x-correlation-id",
    "x-correlation-id": log.correlationId(),
  };
}

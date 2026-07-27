import { apiClient, ApiError } from "@/lib/api-client";

export type CallStatus =
  | "queued"
  | "ringing"
  | "in_progress"
  | "completed"
  | "failed"
  | "no_answer"
  | "busy"
  | "canceled";

export type CallDirection = "inbound" | "outbound";

export type CallSummary = {
  id: string;
  direction: CallDirection;
  status: CallStatus;
  from_number: string;
  to_number: string;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number;
  outcome_category: string | null;
  outcome_summary: string | null;
  sentiment_aggregate: "positive" | "neutral" | "negative" | null;
  sentiment_score: number | null;
  call_purpose: string;
  contact_name: string | null;
  contact_phone: string | null;
  recording_url: string | null;
  has_transcript: boolean;
};

export type TranscriptTurn = {
  index: number;
  role: string;
  text: string;
  sentiment?: "positive" | "neutral" | "negative";
  sentiment_score?: number;
};

export type CallDetail = CallSummary & {
  transcript: TranscriptTurn[];
  classification: {
    category?: string;
    confidence?: number;
    score?: number;
    summary?: string;
    briefing?: {
      dor?: string | null;
      fit?: string | null;
      objections?: string[];
      next_action?: string | null;
    } | null;
  } | null;
  metadata: Record<string, unknown>;
  recording_storage_path: string | null;
  ai_summary: string | null;
};

export const CALL_DIRECTION_LABEL: Record<CallDirection, string> = {
  inbound: "Recebida",
  outbound: "Saída",
};

export const CALL_PURPOSE_LABEL: Record<string, string> = {
  discovery: "Descoberta",
  reminder: "Lembrete T-15",
  noshow_reschedule: "Retry no-show",
  followup: "Follow-up",
};

export const OUTCOME_LABEL: Record<string, { label: string; cls: string }> = {
  scheduled: { label: "Agendou", cls: "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30" },
  qualified: { label: "Qualificou", cls: "bg-primary/10 text-primary ring-1 ring-primary/20" },
  callback: { label: "Pediu retorno", cls: "bg-sky-500/15 text-sky-400 ring-1 ring-sky-500/30" },
  escalated: { label: "Pediu humano", cls: "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30" },
  no_answer: { label: "Sem resposta", cls: "bg-muted text-muted-foreground ring-1 ring-border" },
  voicemail: { label: "Caixa postal", cls: "bg-muted text-muted-foreground ring-1 ring-border" },
  not_interested: { label: "Sem interesse", cls: "bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/30" },
  wrong_number: { label: "Número errado", cls: "bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/30" },
  other: { label: "Outro", cls: "bg-muted text-muted-foreground ring-1 ring-border" },
};

export const STATUS_TONE: Record<CallStatus, string> = {
  queued: "text-muted-foreground",
  ringing: "text-amber-600",
  in_progress: "text-amber-600",
  completed: "text-emerald-600",
  failed: "text-rose-600",
  no_answer: "text-muted-foreground",
  busy: "text-muted-foreground",
  canceled: "text-muted-foreground",
};

interface CallApiRow {
  id: string;
  direction: string;
  status: string;
  from_number: string;
  to_number: string;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number;
  outcome_category: string | null;
  outcome_summary: string | null;
  sentiment: { aggregate?: string; score?: number } | null;
  metadata: Record<string, unknown>;
  recording_url: string | null;
  transcript: unknown;
  contact_name: string | null;
}

interface CallDetailApiRow extends CallApiRow {
  account_id: string;
  recording_storage_path: string | null;
  classification: CallDetail["classification"];
  ai_summary: string | null;
}

function hasTranscript(transcript: unknown): boolean {
  if (Array.isArray(transcript)) return transcript.length > 0;
  if (typeof transcript === "string") return transcript.length > 0;
  return false;
}

function mapSummary(r: CallApiRow): CallSummary {
  const leadPhone = r.direction === "outbound" ? r.to_number : r.from_number;
  return {
    id: r.id,
    direction: r.direction as CallDirection,
    status: r.status as CallStatus,
    from_number: r.from_number,
    to_number: r.to_number,
    started_at: r.started_at,
    ended_at: r.ended_at,
    duration_seconds: r.duration_seconds ?? 0,
    outcome_category: r.outcome_category,
    outcome_summary: r.outcome_summary,
    sentiment_aggregate: (r.sentiment?.aggregate as CallSummary["sentiment_aggregate"]) ?? null,
    sentiment_score: typeof r.sentiment?.score === "number" ? r.sentiment.score : null,
    call_purpose: (r.metadata?.call_purpose as string) ?? "discovery",
    contact_name: r.contact_name,
    contact_phone: leadPhone ?? null,
    recording_url: r.recording_url,
    has_transcript: hasTranscript(r.transcript),
  };
}

export async function fetchCalls(
  accountId: string,
  filter: { direction?: CallDirection | "all"; limit?: number } = {},
): Promise<CallSummary[]> {
  const { direction = "all", limit = 100 } = filter;
  const params = new URLSearchParams({ limit: String(limit) });
  if (direction !== "all") params.set("direction", direction);
  const rows = await apiClient.get<CallApiRow[]>(
    `/accounts/${accountId}/calls?${params.toString()}`,
  );
  return rows.map(mapSummary);
}

export async function fetchCallDetail(
  accountId: string,
  callId: string,
): Promise<CallDetail | null> {
  let r: CallDetailApiRow;
  try {
    r = await apiClient.get<CallDetailApiRow>(`/accounts/${accountId}/calls/${callId}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }

  const sentiment = r.sentiment ?? null;
  const turns = extractTurns(
    r.transcript,
    (r.sentiment as { per_turn?: Parameters<typeof extractTurns>[1] } | null)?.per_turn,
  );

  return {
    ...mapSummary(r),
    transcript: turns,
    classification: r.classification ?? null,
    metadata: r.metadata ?? {},
    recording_storage_path: r.recording_storage_path ?? null,
    ai_summary: r.ai_summary ?? null,
    sentiment_aggregate: (sentiment?.aggregate as CallSummary["sentiment_aggregate"]) ?? null,
  };
}

export async function generateCallSummary(
  accountId: string,
  callId: string,
  force = false,
): Promise<{ ok: boolean; ai_summary?: string; skipped?: boolean; error?: string }> {
  return apiClient.post(`/accounts/${accountId}/voice/calls/${callId}/summary`, { force });
}

function extractTurns(
  transcript: unknown,
  perTurnSentiment?: Array<{
    index: number;
    role: string;
    sentiment: "positive" | "neutral" | "negative";
    score: number;
  }>,
): TranscriptTurn[] {
  if (!transcript) return [];
  const sentMap = new Map<number, { sentiment: string; score: number }>();
  for (const t of perTurnSentiment ?? []) {
    sentMap.set(t.index, { sentiment: t.sentiment, score: t.score });
  }

  if (typeof transcript === "string") {
    return transcript
      .split(/\n+/)
      .map((line, i) => ({ index: i, role: i % 2 === 0 ? "agent" : "user", text: line.trim() }))
      .filter((t) => t.text.length > 0)
      .map((t) => {
        const s = sentMap.get(t.index);
        return s
          ? {
              ...t,
              sentiment: s.sentiment as TranscriptTurn["sentiment"],
              sentiment_score: s.score,
            }
          : t;
      });
  }
  if (Array.isArray(transcript)) {
    return (transcript as Array<Record<string, unknown>>)
      .map((t, i) => ({
        index: i,
        role: String(t.role ?? t.speaker ?? "user").toLowerCase(),
        text: String(t.content ?? t.message ?? t.text ?? "").trim(),
      }))
      .filter((t) => t.text.length > 0)
      .map((t) => {
        const s = sentMap.get(t.index);
        return s
          ? {
              ...t,
              sentiment: s.sentiment as TranscriptTurn["sentiment"],
              sentiment_score: s.score,
            }
          : t;
      });
  }
  return [];
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  if (min < 60) return `${min}m${sec > 0 ? `${sec}s` : ""}`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${m > 0 ? `${m}m` : ""}`;
}

export function formatCallTime(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

import { supabase } from "@/integrations/supabase/client";

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
  scheduled:      { label: "Agendou",          cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" },
  qualified:      { label: "Qualificou",       cls: "bg-primary/10 text-primary ring-1 ring-primary/20" },
  callback:       { label: "Pediu retorno",    cls: "bg-sky-50 text-sky-700 ring-1 ring-sky-200" },
  escalated:      { label: "Pediu humano",     cls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200" },
  no_answer:      { label: "Sem resposta",     cls: "bg-muted text-muted-foreground ring-1 ring-border" },
  voicemail:      { label: "Caixa postal",     cls: "bg-muted text-muted-foreground ring-1 ring-border" },
  not_interested: { label: "Sem interesse",    cls: "bg-rose-50 text-rose-700 ring-1 ring-rose-200" },
  wrong_number:   { label: "Número errado",    cls: "bg-rose-50 text-rose-700 ring-1 ring-rose-200" },
  other:          { label: "Outro",            cls: "bg-muted text-muted-foreground ring-1 ring-border" },
};

export const STATUS_TONE: Record<CallStatus, string> = {
  queued:      "text-muted-foreground",
  ringing:     "text-amber-600",
  in_progress: "text-amber-600",
  completed:   "text-emerald-600",
  failed:      "text-rose-600",
  no_answer:   "text-muted-foreground",
  busy:        "text-muted-foreground",
  canceled:    "text-muted-foreground",
};

export async function fetchCalls(
  accountId: string,
  filter: { direction?: CallDirection | "all"; limit?: number } = {},
): Promise<CallSummary[]> {
  const { direction = "all", limit = 100 } = filter;

  let query = (supabase as any)
    .from("voice_calls")
    .select(
      "id, direction, status, from_number, to_number, started_at, ended_at, duration_seconds, outcome_category, outcome_summary, sentiment, metadata, recording_url, transcript",
    )
    .eq("account_id", accountId)
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (direction !== "all") {
    query = query.eq("direction", direction);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as any[];

  // Resolve contact names via phone match (cheap N+1 acceptable for limit=100).
  const phones = Array.from(
    new Set(
      rows
        .map((r) =>
          r.direction === "outbound" ? r.to_number : r.from_number,
        )
        .filter(Boolean),
    ),
  );

  const contactMap: Record<string, { name: string | null; phone: string }> = {};
  if (phones.length > 0) {
    const { data: contacts } = await (supabase as any)
      .from("contacts")
      .select("name, phone_number")
      .eq("account_id", accountId)
      .in("phone_number", phones);
    for (const c of (contacts ?? []) as any[]) {
      contactMap[c.phone_number] = { name: c.name, phone: c.phone_number };
    }
  }

  return rows.map((r): CallSummary => {
    const leadPhone = r.direction === "outbound" ? r.to_number : r.from_number;
    const contact = leadPhone ? contactMap[leadPhone] : undefined;
    const sentiment = (r.sentiment ?? null) as any;
    const transcript = r.transcript;
    return {
      id: r.id,
      direction: r.direction,
      status: r.status,
      from_number: r.from_number,
      to_number: r.to_number,
      started_at: r.started_at,
      ended_at: r.ended_at,
      duration_seconds: r.duration_seconds ?? 0,
      outcome_category: r.outcome_category,
      outcome_summary: r.outcome_summary,
      sentiment_aggregate: sentiment?.aggregate ?? null,
      sentiment_score: typeof sentiment?.score === "number" ? sentiment.score : null,
      call_purpose: (r.metadata as any)?.call_purpose ?? "discovery",
      contact_name: contact?.name ?? null,
      contact_phone: leadPhone ?? null,
      recording_url: r.recording_url ?? null,
      has_transcript:
        Array.isArray(transcript) && transcript.length > 0
          ? true
          : typeof transcript === "string" && transcript.length > 0
            ? true
            : false,
    };
  });
}

export async function fetchCallDetail(callId: string): Promise<CallDetail | null> {
  const { data, error } = await (supabase as any)
    .from("voice_calls")
    .select(
      "id, account_id, direction, status, from_number, to_number, started_at, ended_at, duration_seconds, outcome_category, outcome_summary, sentiment, metadata, recording_url, recording_storage_path, transcript, classification, ai_summary",
    )
    .eq("id", callId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const r = data as any;
  const leadPhone = r.direction === "outbound" ? r.to_number : r.from_number;
  let contactName: string | null = null;
  if (leadPhone) {
    const { data: c } = await (supabase as any)
      .from("contacts")
      .select("name")
      .eq("account_id", r.account_id)
      .eq("phone_number", leadPhone)
      .maybeSingle();
    contactName = (c as any)?.name ?? null;
  }

  const sentiment = (r.sentiment ?? null) as any;
  const turns = extractTurns(r.transcript, sentiment?.per_turn);

  return {
    id: r.id,
    direction: r.direction,
    status: r.status,
    from_number: r.from_number,
    to_number: r.to_number,
    started_at: r.started_at,
    ended_at: r.ended_at,
    duration_seconds: r.duration_seconds ?? 0,
    outcome_category: r.outcome_category,
    outcome_summary: r.outcome_summary,
    sentiment_aggregate: sentiment?.aggregate ?? null,
    sentiment_score: typeof sentiment?.score === "number" ? sentiment.score : null,
    call_purpose: (r.metadata as any)?.call_purpose ?? "discovery",
    contact_name: contactName,
    contact_phone: leadPhone ?? null,
    recording_url: r.recording_url ?? null,
    has_transcript: turns.length > 0,
    transcript: turns,
    classification: r.classification ?? null,
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
    recording_storage_path: r.recording_storage_path ?? null,
  };
}

function extractTurns(
  transcript: any,
  perTurnSentiment?: Array<{
    index: number;
    role: string;
    sentiment: "positive" | "neutral" | "negative";
    score: number;
  }>,
): TranscriptTurn[] {
  if (!transcript) return [];
  const sentMap = new Map<number, { sentiment: any; score: number }>();
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
        return s ? { ...t, sentiment: s.sentiment, sentiment_score: s.score } : t;
      });
  }
  if (Array.isArray(transcript)) {
    return transcript
      .map((t: any, i: number) => ({
        index: i,
        role: String(t.role ?? t.speaker ?? "user").toLowerCase(),
        text: String(t.content ?? t.message ?? t.text ?? "").trim(),
      }))
      .filter((t) => t.text.length > 0)
      .map((t) => {
        const s = sentMap.get(t.index);
        return s ? { ...t, sentiment: s.sentiment, sentiment_score: s.score } : t;
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

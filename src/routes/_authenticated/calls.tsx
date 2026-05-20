import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  Sparkles,
  User as UserIcon,
  Volume2,
  Smile,
  Meh,
  Frown,
  Search,
} from "lucide-react";
import { useAccount } from "@/lib/account-context";
import {
  fetchCalls,
  fetchCallDetail,
  formatDuration,
  formatCallTime,
  CALL_DIRECTION_LABEL,
  CALL_PURPOSE_LABEL,
  OUTCOME_LABEL,
  STATUS_TONE,
  type CallSummary,
  type CallDetail,
  type CallDirection,
  type TranscriptTurn,
} from "@/lib/calls";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/calls")({
  head: () => ({
    meta: [
      { title: "Ligações — Nina Talks" },
      {
        name: "description",
        content:
          "Histórico de ligações da Nina com transcrição, sentimento e briefing.",
      },
    ],
  }),
  component: CallsPage,
});

function CallsPage() {
  const { accountId } = useAccount();
  const [data, setData] = useState<CallSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [direction, setDirection] = useState<CallDirection | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accountId) {
      setLoading(false);
      return;
    }
    try {
      const rows = await fetchCalls(accountId, { direction, limit: 100 });
      setData(rows);
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao buscar ligações");
    } finally {
      setLoading(false);
    }
  }, [accountId, direction]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.trim().toLowerCase();
    return data.filter(
      (c) =>
        (c.contact_name && c.contact_name.toLowerCase().includes(q)) ||
        (c.contact_phone && c.contact_phone.toLowerCase().includes(q)) ||
        (c.outcome_summary && c.outcome_summary.toLowerCase().includes(q)),
    );
  }, [data, search]);

  const counts = useMemo(() => {
    let inbound = 0, outbound = 0;
    for (const c of data) {
      if (c.direction === "inbound") inbound++;
      else outbound++;
    }
    return { inbound, outbound, all: data.length };
  }, [data]);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <header className="mb-6">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Ligações
          </h1>
          {!loading && (
            <span className="text-sm text-muted-foreground">
              {data.length} {data.length === 1 ? "registro" : "registros"}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Histórico de chamadas atendidas e disparadas pela Nina, com transcrição,
          sentimento e briefing IA.
        </p>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, telefone ou resumo"
            className="h-10 pl-10"
          />
        </div>
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-sm">
          <FilterChip
            active={direction === "all"}
            onClick={() => setDirection("all")}
            label="Todas"
            count={counts.all}
          />
          <FilterChip
            active={direction === "inbound"}
            onClick={() => setDirection("inbound")}
            label="Recebidas"
            count={counts.inbound}
          />
          <FilterChip
            active={direction === "outbound"}
            onClick={() => setDirection("outbound")}
            label="Saídas"
            count={counts.outbound}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex h-[40vh] items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/40 py-20 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Phone className="h-5 w-5 text-primary" />
          </div>
          <p className="text-sm font-medium text-foreground">
            Nenhuma ligação com esses filtros.
          </p>
          <p className="mt-1 max-w-xs text-xs text-muted-foreground">
            Ligações aparecem aqui assim que a Nina atender ou disparar uma
            chamada.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => (
            <CallRow
              key={c.id}
              call={c}
              onClick={() => setSelectedId(c.id)}
            />
          ))}
        </div>
      )}

      <Sheet
        open={!!selectedId}
        onOpenChange={(o) => !o && setSelectedId(null)}
      >
        <SheetContent className="w-[560px] sm:max-w-[560px] overflow-y-auto">
          {selectedId && <CallDetailSheet callId={selectedId} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
          active ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function initialsFrom(name: string | null, phone: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (first + last).toUpperCase() || "?";
  }
  if (phone) {
    const digits = phone.replace(/\D/g, "");
    return digits.slice(-2) || "?";
  }
  return "?";
}

function CallRow({
  call,
  onClick,
}: {
  call: CallSummary;
  onClick: () => void;
}) {
  const dirIcon =
    call.direction === "inbound" ? PhoneIncoming : PhoneOutgoing;
  const DirIcon = dirIcon;
  const outcome = call.outcome_category
    ? OUTCOME_LABEL[call.outcome_category] ?? OUTCOME_LABEL.other
    : null;
  const displayName = call.contact_name ?? call.contact_phone ?? "Lead";

  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-4 rounded-xl border border-border bg-card px-4 py-3.5 text-left shadow-sm transition hover:border-primary/30 hover:shadow-md"
    >
      <div className="relative shrink-0">
        <div
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-full text-sm font-semibold",
            call.contact_name
              ? "bg-primary/10 text-primary"
              : "bg-muted text-muted-foreground",
          )}
        >
          {initialsFrom(call.contact_name, call.contact_phone)}
        </div>
        <div
          className={cn(
            "absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full ring-2 ring-card",
            call.direction === "inbound"
              ? "bg-sky-100 text-sky-700"
              : "bg-primary/15 text-primary",
          )}
        >
          <DirIcon className="h-3 w-3" />
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">
            {displayName}
          </span>
          {call.contact_name && call.contact_phone && (
            <span className="truncate text-xs text-muted-foreground tabular-nums">
              · {call.contact_phone}
            </span>
          )}
          <SentimentBadge sentiment={call.sentiment_aggregate} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground">
          <span className="tabular-nums">{formatCallTime(call.started_at)}</span>
          {call.duration_seconds > 0 && (
            <>
              <span className="text-border">·</span>
              <span className="tabular-nums">
                {formatDuration(call.duration_seconds)}
              </span>
            </>
          )}
          <span className="text-border">·</span>
          <span className={cn("font-medium", STATUS_TONE[call.status])}>
            {call.status}
          </span>
          {call.call_purpose !== "discovery" && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground/70">
              {CALL_PURPOSE_LABEL[call.call_purpose] ?? call.call_purpose}
            </span>
          )}
        </div>
        {call.outcome_summary && (
          <p className="mt-1 line-clamp-1 text-xs text-muted-foreground/90">
            {call.outcome_summary}
          </p>
        )}
      </div>

      {outcome && (
        <span
          className={cn(
            "shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium",
            outcome.cls,
          )}
        >
          {outcome.label}
        </span>
      )}
    </button>
  );
}

function SentimentBadge({
  sentiment,
}: {
  sentiment: "positive" | "neutral" | "negative" | null;
}) {
  if (!sentiment) return null;
  const Icon = sentiment === "positive" ? Smile : sentiment === "negative" ? Frown : Meh;
  const cls =
    sentiment === "positive"
      ? "text-emerald-600"
      : sentiment === "negative"
        ? "text-rose-600"
        : "text-muted-foreground";
  return <Icon className={cn("h-3.5 w-3.5", cls)} />;
}

function CallDetailSheet({ callId }: { callId: string }) {
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchCallDetail(callId)
      .then(setDetail)
      .catch((e) => toast.error(e?.message ?? "falha ao carregar"))
      .finally(() => setLoading(false));
  }, [callId]);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!detail) {
    return (
      <SheetHeader>
        <SheetTitle>Ligação não encontrada</SheetTitle>
      </SheetHeader>
    );
  }

  const outcome = detail.outcome_category
    ? OUTCOME_LABEL[detail.outcome_category] ?? OUTCOME_LABEL.other
    : null;
  const briefing = detail.classification?.briefing ?? null;

  return (
    <>
      <SheetHeader>
        <SheetTitle>
          {detail.contact_name ?? detail.contact_phone ?? "Ligação"}
        </SheetTitle>
      </SheetHeader>

      <div className="mt-4 space-y-4">
        {/* Header chips */}
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
              detail.direction === "inbound"
                ? "bg-sky-500/10 text-sky-700 ring-sky-500/20"
                : "bg-primary/10 text-primary ring-primary/20",
            )}
          >
            {CALL_DIRECTION_LABEL[detail.direction]}
          </span>
          <span className={cn("text-[11px] font-medium", STATUS_TONE[detail.status])}>
            {detail.status}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {formatCallTime(detail.started_at)}
          </span>
          {detail.duration_seconds > 0 && (
            <span className="text-[11px] text-muted-foreground">
              · {formatDuration(detail.duration_seconds)}
            </span>
          )}
          {outcome && (
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                outcome.cls,
              )}
            >
              {outcome.label}
            </span>
          )}
          {detail.call_purpose !== "discovery" && (
            <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-foreground/70">
              {CALL_PURPOSE_LABEL[detail.call_purpose] ?? detail.call_purpose}
            </span>
          )}
        </div>

        {/* Contact info */}
        <div className="space-y-1.5 rounded-xl border border-border bg-card p-3 text-xs">
          <Row icon={<UserIcon className="h-3.5 w-3.5 text-muted-foreground" />}>
            {detail.contact_name ?? "Sem nome"}
          </Row>
          <Row icon={<Phone className="h-3.5 w-3.5 text-muted-foreground" />}>
            {detail.contact_phone ?? "—"}
          </Row>
        </div>

        {/* Resumo IA */}
        <AiSummaryBlock
          callId={detail.id}
          initial={detail.ai_summary}
          onUpdate={(s) => setDetail((prev) => (prev ? { ...prev, ai_summary: s } : prev))}
        />


        {(detail.outcome_summary || detail.sentiment_aggregate) && (
          <div className="space-y-2 rounded-xl border border-border bg-card p-3">
            {detail.outcome_summary && (
              <p className="text-xs leading-relaxed text-foreground/80">
                {detail.outcome_summary}
              </p>
            )}
            {detail.sentiment_aggregate && (
              <div className="flex items-center gap-2 text-[11px]">
                <SentimentBadge sentiment={detail.sentiment_aggregate} />
                <span className="font-medium text-foreground capitalize">
                  {detail.sentiment_aggregate}
                </span>
                {detail.sentiment_score != null && (
                  <span className="text-muted-foreground">
                    score {detail.sentiment_score.toFixed(2)}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Briefing */}
        {briefing &&
          (briefing.dor || briefing.fit || briefing.next_action ||
            (briefing.objections && briefing.objections.length > 0)) && (
          <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/[0.04] p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
              <Sparkles className="h-3 w-3" />
              Briefing IA
            </div>
            {briefing.dor && <Field label="Dor" value={briefing.dor} />}
            {briefing.fit && <Field label="Fit" value={briefing.fit} />}
            {briefing.objections && briefing.objections.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Objeções
                </div>
                <ul className="mt-1 space-y-0.5 text-xs text-foreground/80">
                  {briefing.objections.map((o, i) => (
                    <li key={i}>· {o}</li>
                  ))}
                </ul>
              </div>
            )}
            {briefing.next_action && (
              <Field label="Próxima ação" value={briefing.next_action} />
            )}
          </div>
        )}

        {/* Recording */}
        {detail.recording_url && (
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Volume2 className="h-3 w-3" />
              Gravação
            </div>
            <audio
              src={detail.recording_url}
              controls
              preload="none"
              className="w-full"
            />
          </div>
        )}

        {/* Transcript */}
        {detail.transcript.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Transcrição ({detail.transcript.length} turnos)
            </div>
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
              {detail.transcript.map((t) => (
                <TranscriptTurnRow key={t.index} turn={t} />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function TranscriptTurnRow({ turn }: { turn: TranscriptTurn }) {
  const isAgent = turn.role === "agent" || turn.role === "assistant";
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-xs",
        isAgent
          ? "border-primary/15 bg-primary/[0.05] text-foreground"
          : "border-border bg-muted/40 text-foreground",
      )}
    >
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
        <span className={isAgent ? "text-primary" : "text-sky-700"}>
          {isAgent ? "Nina" : "Lead"}
        </span>
        {turn.sentiment && (
          <SentimentBadge sentiment={turn.sentiment} />
        )}
      </div>
      <p className="leading-relaxed text-foreground/85">{turn.text}</p>
    </div>
  );
}

function Row({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-foreground">
      {icon}
      <span>{children}</span>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xs leading-relaxed text-foreground/85">{value}</div>
    </div>
  );
}

function AiSummaryBlock({
  callId,
  initial,
  onUpdate,
}: {
  callId: string;
  initial: string | null;
  onUpdate: (s: string) => void;
}) {
  const [text, setText] = useState<string | null>(initial);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setText(initial);
  }, [initial, callId]);

  const generate = async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase.functions as any).invoke(
        "call-summary-generate",
        { body: { call_id: callId } },
      );
      if (error) throw error;
      const s = (data as any)?.summary as string | undefined;
      if (s) {
        setText(s);
        onUpdate(s);
        toast.success("Resumo gerado");
      } else {
        toast.error("Não foi possível gerar o resumo");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao gerar resumo");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-primary/20 bg-primary/[0.04] p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
          <Sparkles className="h-3 w-3" />
          Resumo IA
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="rounded-md border border-primary/30 bg-card px-2 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
        >
          {loading ? "Gerando…" : text ? "Regenerar" : "Gerar resumo"}
        </button>
      </div>
      {text ? (
        <div className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/85">
          {text}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Nenhum resumo ainda. Clique em “Gerar resumo” para criar um briefing executivo desta ligação.
        </p>
      )}
    </div>
  );
}

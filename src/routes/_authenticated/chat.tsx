import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  Loader2,
  Radio,
  RefreshCw,
  Mic,
  User as UserIcon,
  History,
  Bot,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useAccount } from "@/lib/account-context";
import { subscribeTable } from "@/lib/realtime-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { fetchVoiceCalls, type VoiceCall } from "@/lib/voice";
import { NewCallDialog } from "@/components/calls/NewCallDialog";
import { formatDuration } from "@/lib/calls";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({
    meta: [
      { title: "Ao vivo — Nina Talks" },
      {
        name: "description",
        content: "Acompanhe ligações da Nina em tempo real com transcrição ao vivo.",
      },
    ],
  }),
  component: LiveCallsPage,
});

const ACTIVE_STATUSES = new Set(["queued", "ringing", "in_progress"]);

function isActive(c: VoiceCall): boolean {
  return ACTIVE_STATUSES.has(c.status);
}

function durationFor(call: VoiceCall): number {
  if (call.duration_seconds && call.duration_seconds > 0) return call.duration_seconds;
  if (call.started_at) {
    return Math.max(0, Math.floor((Date.now() - new Date(call.started_at).getTime()) / 1000));
  }
  return 0;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s atrás`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function LiveCallsPage() {
  const { accountId } = useAccount();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newCallOpen, setNewCallOpen] = useState(false);
  const [, setTick] = useState(0);

  // Tick every second so "00:42" durations update for active calls.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const queryKey = useMemo(() => ["voice-calls", accountId] as const, [accountId]);
  const { data: calls = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchVoiceCalls(accountId!, 50),
    enabled: !!accountId,
    staleTime: 15_000,
  });
  const loading = isLoading && calls.length === 0;

  // Realtime: invalida o cache quando voice_calls muda (a query já tem
  // staleTime curto, então o refetch é praticamente instantâneo).
  useEffect(() => {
    if (!accountId) return;
    return subscribeTable("voice_calls", (e) => {
      if (e.accountId !== accountId) return;
      queryClient.invalidateQueries({ queryKey });
    });
  }, [accountId, queryClient, queryKey]);

  const activeCalls = useMemo(() => calls.filter(isActive), [calls]);
  const recentCalls = useMemo(() => calls.filter((c) => !isActive(c)).slice(0, 30), [calls]);

  // Auto-select most recent active call when one starts and nothing is selected.
  useEffect(() => {
    if (!selectedId && activeCalls.length > 0) {
      setSelectedId(activeCalls[0].id);
    }
  }, [activeCalls, selectedId]);

  const selectedCall = useMemo(
    () => calls.find((c) => c.id === selectedId) ?? null,
    [calls, selectedId],
  );

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-0 w-full">
      {/* Column 1: live + recent calls list */}
      <aside className="flex h-full w-[340px] shrink-0 flex-col border-r border-gray-200 dark:border-slate-800 bg-background">
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-slate-800 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Ao vivo</h2>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              {activeCalls.length > 0 ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                  {activeCalls.length}{" "}
                  {activeCalls.length === 1 ? "chamada ativa" : "chamadas ativas"}
                </>
              ) : (
                <>Nenhuma chamada em curso</>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => queryClient.invalidateQueries({ queryKey })}
            title="Atualizar"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        <div className="border-b border-gray-200 dark:border-slate-800 px-3 py-2">
          <Button size="sm" className="w-full gap-1.5" onClick={() => setNewCallOpen(true)}>
            <Phone className="h-3.5 w-3.5" />
            Nova chamada
          </Button>
        </div>

        <ScrollArea className="flex-1">
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-3 px-2 py-2">
              {/* Active section */}
              {activeCalls.length > 0 && (
                <div>
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                    Em andamento
                  </div>
                  <ul className="space-y-1">
                    {activeCalls.map((c) => (
                      <CallListItem
                        key={c.id}
                        call={c}
                        active={c.id === selectedId}
                        live
                        onClick={() => setSelectedId(c.id)}
                      />
                    ))}
                  </ul>
                </div>
              )}

              {/* Recent section */}
              <div>
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Recentes
                </div>
                {recentCalls.length === 0 ? (
                  <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                    Nenhuma chamada ainda.
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {recentCalls.map((c) => (
                      <CallListItem
                        key={c.id}
                        call={c}
                        active={c.id === selectedId}
                        onClick={() => setSelectedId(c.id)}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </ScrollArea>

        <div className="border-t border-gray-200 dark:border-slate-800 px-3 py-2">
          <Link
            to="/calls"
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <History className="h-3.5 w-3.5" />
            Ver histórico completo →
          </Link>
        </div>
      </aside>

      {/* Column 2: live transcript */}
      <section className="flex h-full min-w-0 flex-1 flex-col bg-muted/20">
        {!selectedCall ? (
          <EmptyTranscriptPanel
            onNewCall={() => setNewCallOpen(true)}
            hasActive={activeCalls.length > 0}
          />
        ) : (
          <CallTranscriptPanel call={selectedCall} />
        )}
      </section>

      <NewCallDialog
        open={newCallOpen}
        onOpenChange={setNewCallOpen}
        accountId={accountId}
        onPlaced={(callId) => setSelectedId(callId)}
      />
    </div>
  );
}

function CallListItem({
  call,
  active,
  live,
  onClick,
}: {
  call: VoiceCall;
  active: boolean;
  live?: boolean;
  onClick: () => void;
}) {
  const Icon = call.direction === "inbound" ? PhoneIncoming : PhoneOutgoing;
  const peer = call.direction === "inbound" ? call.from_number : call.to_number;
  const dur = durationFor(call);

  return (
    <li>
      <button
        onClick={onClick}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition",
          active ? "bg-primary/10" : "hover:bg-muted",
        )}
      >
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
            live
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : call.direction === "inbound"
                ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                : "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-mono text-[11px] font-medium">{peer}</span>
            {live && (
              <span className="shrink-0 rounded-sm bg-emerald-500/20 px-1 text-[9px] font-semibold uppercase text-emerald-700 dark:text-emerald-300">
                live
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            {live ? (
              <span className="font-mono text-emerald-600 dark:text-emerald-400">
                {formatDuration(dur)}
              </span>
            ) : (
              <>
                {dur > 0 && <span>{formatDuration(dur)}</span>}
                <span>·</span>
                <span>{timeAgo(call.started_at ?? call.created_at)}</span>
              </>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

function EmptyTranscriptPanel({
  onNewCall,
  hasActive,
}: {
  onNewCall: () => void;
  hasActive: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
        <Radio className="h-7 w-7 text-primary" />
      </div>
      <h3 className="text-base font-semibold">
        {hasActive ? "Selecione uma chamada para ver a transcrição" : "Nenhuma chamada ao vivo"}
      </h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {hasActive
          ? "As transcrições aparecem em tempo real conforme a Nina conversa."
          : "Quando a Nina atender ou disparar uma ligação, ela aparece aqui em realtime — com transcrição turn-by-turn."}
      </p>
      <div className="mt-5 flex gap-2">
        <Button onClick={onNewCall} size="sm" className="gap-1.5">
          <Phone className="h-3.5 w-3.5" />
          Disparar chamada manual
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link to="/phone-numbers">Configurar número</Link>
        </Button>
      </div>
    </div>
  );
}

function CallTranscriptPanel({ call }: { call: VoiceCall }) {
  const live = isActive(call);
  const Icon = call.direction === "inbound" ? PhoneIncoming : PhoneOutgoing;
  const peer = call.direction === "inbound" ? call.from_number : call.to_number;
  const dur = durationFor(call);

  // Normalize transcript turns
  const turns = useMemo(() => {
    const raw = call.transcript as unknown;
    if (!raw) return [] as Array<{ index: number; role: string; text: string; at: string | null }>;
    if (Array.isArray(raw)) {
      return raw
        .map((row: any, i: number) => ({
          index: i,
          role: String(row?.role ?? row?.speaker ?? "user").toLowerCase(),
          text: String(row?.content ?? row?.message ?? row?.text ?? "").trim(),
          at: (row?.at ?? null) as string | null,
        }))
        .filter((r) => r.text.length > 0);
    }
    if (typeof raw === "string") {
      return raw
        .split(/\n+/)
        .map((line: string, i: number) => ({
          index: i,
          role: i % 2 === 0 ? "agent" : "user",
          text: line.trim(),
          at: null as string | null,
        }))
        .filter((r) => r.text.length > 0);
    }
    return [] as Array<{ index: number; role: string; text: string; at: string | null }>;
  }, [call.transcript]);

  // Auto-scroll to last turn when new content arrives.
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length]);

  return (
    <>
      <header className="flex items-center justify-between border-b border-gray-200 dark:border-slate-800 bg-background px-5 py-3">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg",
              live
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-muted text-muted-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <div className="font-mono text-sm font-semibold">{peer}</div>
              {live && (
                <Badge className="bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/20 hover:bg-emerald-500/20 dark:text-emerald-300">
                  <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                  Ao vivo
                </Badge>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>{call.direction === "inbound" ? "Recebida" : "Saída"}</span>
              <span>·</span>
              <span className={cn("font-mono", live && "text-emerald-600 dark:text-emerald-400")}>
                {formatDuration(dur)}
              </span>
              {call.persona_id && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <Bot className="h-3 w-3" /> Nina
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="mx-auto w-full max-w-3xl space-y-2 px-5 py-6">
          {turns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Mic className="mb-3 h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {live
                  ? "Aguardando primeiro turno da conversa…"
                  : "Esta chamada não tem transcrição."}
              </p>
            </div>
          ) : (
            turns.map((t) => (
              <TranscriptBubble key={t.index} role={t.role} text={t.text} at={t.at} />
            ))
          )}
          <div ref={endRef} />
        </div>
      </ScrollArea>

      {!live && (
        <footer className="border-t border-gray-200 dark:border-slate-800 bg-background px-5 py-2.5">
          <Link to="/calls" className="text-[11px] text-muted-foreground hover:text-foreground">
            Ver detalhes completos da chamada (briefing, sentimento, gravação) →
          </Link>
        </footer>
      )}
    </>
  );
}

function TranscriptBubble({ role, text, at }: { role: string; text: string; at: string | null }) {
  const isAgent = role === "agent" || role === "assistant" || role === "ai";
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5 text-sm",
        isAgent ? "border-cyan-500/15 bg-cyan-500/[0.03]" : "border-gray-200 dark:border-slate-800 bg-background",
      )}
    >
      <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {isAgent ? (
          <>
            <Bot className="h-3 w-3 text-cyan-500" />
            <span className="text-cyan-600 dark:text-cyan-300">Nina</span>
          </>
        ) : (
          <>
            <UserIcon className="h-3 w-3 text-sky-500" />
            <span className="text-sky-600 dark:text-sky-300">Lead</span>
          </>
        )}
        {at && (
          <span className="ml-auto opacity-60">
            {new Date(at).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        )}
      </div>
      <p className="leading-relaxed">{text}</p>
    </div>
  );
}

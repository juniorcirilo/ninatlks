import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Phone,
  Mail,
  Sparkles,
  RefreshCw,
  PhoneCall,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useAccount } from "@/lib/account-context";
import { useRealtimeRefresh } from "@/lib/realtime-client";
import {
  fetchPipeline,
  moveLeadToStage,
  stageTone,
  timeAgo,
  type LeadCard,
  type Pipeline,
  type Stage,
} from "@/lib/pipeline";
import { fetchCalls, fetchCallDetail, formatCallTime, CALL_DIRECTION_LABEL } from "@/lib/calls";
import {
  LeadAvatar,
  ScoreBadge,
  SentimentBadge,
  StageBadge,
  OutcomeBadge,
  AiSourceBadge,
} from "@/components/pipeline/badges";
import { AiSummaryBlock, TranscriptTurnRow } from "@/components/calls/ai-summary";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export const Route = createFileRoute("/_authenticated/pipeline")({
  head: () => ({
    meta: [
      { title: "Pipeline — Nina Talks" },
      {
        name: "description",
        content: "Funil de leads com auto-classificação por sentimento da IA.",
      },
    ],
  }),
  component: PipelinePage,
});

type MoveVars = { contactId: string; stageId: string; reason?: string };

function PipelinePage() {
  const { accountId } = useAccount();
  const queryClient = useQueryClient();
  const [selectedLead, setSelectedLead] = useState<{ lead: LeadCard; stage: Stage } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [aiPulse, setAiPulse] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const queryKey = useMemo(() => ["pipeline", accountId] as const, [accountId]);
  const {
    data,
    isLoading,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey,
    queryFn: () => fetchPipeline(accountId!),
    enabled: !!accountId,
    staleTime: 30_000,
  });

  const loading = isLoading && !data;
  const error = queryError ? (queryError as Error).message : null;
  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  // Realtime: a Nina muda contatos fora desta tela (pós-ligação) — o pulso no
  // header é o único sinal visível de que algo aconteceu sem o usuário mexer.
  useRealtimeRefresh(["contacts"], accountId, () => {
    queryClient.invalidateQueries({ queryKey });
    setAiPulse(true);
    window.setTimeout(() => setAiPulse(false), 2500);
  });

  const moveMutation = useMutation({
    mutationFn: ({ contactId, stageId, reason }: MoveVars) =>
      moveLeadToStage(accountId!, contactId, stageId, reason),
    onMutate: async ({ contactId, stageId }) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<Pipeline>(queryKey);
      if (prev) {
        let lead: LeadCard | null = null;
        for (const s of prev.stages) {
          const found = s.leads.find((x) => x.id === contactId);
          if (found) {
            lead = found;
            break;
          }
        }
        if (lead) {
          const movedLead: LeadCard = { ...lead, stage_source: "manual", auto_moved_at: null };
          const next: Pipeline = {
            ...prev,
            stages: prev.stages.map((s) => {
              const filtered = s.leads.filter((x) => x.id !== contactId);
              return s.id === stageId
                ? { ...s, leads: [movedLead, ...filtered] }
                : { ...s, leads: filtered };
            }),
          };
          queryClient.setQueryData(queryKey, next);
        }
      }
      return { prev };
    },
    onError: (err: any, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev);
      toast.error(err?.message ?? "falha ao mover");
    },
    onSuccess: () => toast.success("Lead movido"),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const pendingLeadId = moveMutation.isPending ? (moveMutation.variables?.contactId ?? null) : null;

  const totals = useMemo(() => {
    if (!data) return { leads: 0, won: 0, lost: 0, qualified: 0 };
    let leads = 0,
      won = 0,
      lost = 0,
      qualified = 0;
    for (const s of data.stages) {
      leads += s.leads.length;
      if (s.is_won) won += s.leads.length;
      if (s.is_lost) lost += s.leads.length;
      if (!s.is_won && !s.is_lost) qualified += s.leads.length;
    }
    return { leads, won, lost, qualified };
  }, [data]);

  const activeLead = useMemo(() => {
    if (!activeId || !data) return null;
    for (const s of data.stages) {
      const l = s.leads.find((x) => x.id === activeId);
      if (l) return { lead: l, stage: s };
    }
    return null;
  }, [activeId, data]);

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const leadId = String(e.active.id);
    const targetStageId = e.over ? String(e.over.id) : null;
    if (!targetStageId || !data) return;

    let sourceStageId: string | null = null;
    for (const s of data.stages) {
      if (s.leads.some((x) => x.id === leadId)) {
        sourceStageId = s.id;
        break;
      }
    }
    if (!sourceStageId || sourceStageId === targetStageId) return;
    moveMutation.mutate({ contactId: leadId, stageId: targetStageId });
  }

  async function handleDetailMove(stageId: string, reason?: string) {
    if (!selectedLead) return;
    try {
      await moveMutation.mutateAsync({ contactId: selectedLead.lead.id, stageId, reason });
      setSelectedLead(null);
    } catch {
      // toast de erro já disparado pelo onError da mutation
    }
  }

  if (loading) return <PipelineSkeleton />;

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" onClick={refresh} className="mt-4">
          Tentar de novo
        </Button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 px-6 py-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Pipeline</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{totals.leads}</span>{" "}
            {totals.leads === 1 ? "lead" : "leads"}
            <Dot />
            <span className="text-foreground">{totals.qualified}</span> em fluxo
            <Dot />
            <span className="text-success">{totals.won}</span> ganhos
            <Dot />
            <span className="text-destructive">{totals.lost}</span> perdidos
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors sm:inline-flex",
              aiPulse
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-accent/20 bg-accent/5 text-accent",
            )}
          >
            <span
              className={cn("h-1.5 w-1.5 rounded-full bg-accent", aiPulse && "animate-pulse")}
            />
            <Sparkles className="h-3 w-3" />
            Auto-classificação por IA
          </span>
          <Button variant="outline" size="sm" onClick={refresh} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Atualizar
          </Button>
        </div>
      </header>

      {totals.leads === 0 ? (
        <EmptyPipelineState />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex-1 overflow-x-auto overflow-y-hidden px-4 py-4 snap-x snap-mandatory sm:snap-none">
            <div className="flex h-full min-w-max gap-3 sm:gap-4">
              {data.stages.map((stage) => (
                <Column
                  key={stage.id}
                  stage={stage}
                  pendingLeadId={pendingLeadId}
                  onLeadClick={(lead) => setSelectedLead({ lead, stage })}
                />
              ))}
            </div>
          </div>

          <DragOverlay
            dropAnimation={{ duration: 180, easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)" }}
          >
            {activeLead ? (
              <div className="rotate-2 scale-105 opacity-95">
                <LeadCardInner lead={activeLead.lead} dragging />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <Sheet open={!!selectedLead} onOpenChange={(o) => !o && setSelectedLead(null)}>
        <SheetContent className="w-[560px] sm:max-w-[560px] overflow-y-auto">
          {selectedLead && accountId && (
            <LeadDetail
              lead={selectedLead.lead}
              stage={selectedLead.stage}
              allStages={data.stages}
              accountId={accountId}
              onMove={handleDetailMove}
              moving={
                moveMutation.isPending && moveMutation.variables?.contactId === selectedLead.lead.id
              }
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Dot() {
  return <span className="h-1 w-1 rounded-full bg-border" aria-hidden />;
}

/* ─────────────── Estados de carregamento / vazio ─────────────── */

function PipelineSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex items-center justify-between gap-4 border-b border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 px-6 py-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-8 w-28" />
      </header>
      <div className="flex-1 overflow-hidden px-4 py-4">
        <div className="flex h-full gap-3 sm:gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex w-[300px] shrink-0 flex-col gap-2.5 rounded-2xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-2.5 shadow-elevation-1"
            >
              <Skeleton className="h-5 w-24" />
              {Array.from({ length: 3 }).map((_, j) => (
                <Skeleton key={j} className="h-24 w-full rounded-xl" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EmptyPipelineState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="rounded-full bg-accent/10 p-3">
        <Sparkles className="h-6 w-6 text-accent" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">Nenhum lead no funil ainda</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          Leads aparecem aqui assim que a Nina atende a primeira ligação ou mensagem, ou quando você
          importa contatos.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to="/contacts">Importar contatos</Link>
        </Button>
        <Button asChild size="sm">
          <Link to="/campanhas">Iniciar campanha</Link>
        </Button>
      </div>
    </div>
  );
}

/* ─────────────── Column (drop target) ─────────────── */

function Column({
  stage,
  pendingLeadId,
  onLeadClick,
}: {
  stage: Stage;
  pendingLeadId: string | null;
  onLeadClick: (lead: LeadCard) => void;
}) {
  const tone = stageTone(stage.color);
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex h-full w-[300px] shrink-0 snap-center flex-col rounded-2xl border bg-white dark:bg-slate-900/40 shadow-elevation-1 transition sm:w-[300px]",
        "max-sm:w-[85vw]",
        isOver ? "border-accent ring-2 ring-accent/40 shadow-elevation-3" : "border-gray-200 dark:border-slate-800",
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-gray-200 dark:border-slate-800 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("h-2 w-2 shrink-0 rounded-full", tone.dot)} />
          <h2 className="truncate text-sm font-semibold text-foreground">{stage.name}</h2>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {stage.leads.length}
        </span>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
        {stage.leads.length === 0 ? (
          <div className="flex h-28 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-gray-200 dark:border-slate-800 bg-muted/30 px-3 text-center">
            <p className="text-xs font-medium text-muted-foreground">Coluna vazia</p>
            <p className="text-[10px] text-muted-foreground/80">
              Arraste leads ou aguarde a Nina classificar
            </p>
          </div>
        ) : (
          stage.leads.map((lead) => (
            <DraggableLead
              key={lead.id}
              lead={lead}
              pending={lead.id === pendingLeadId}
              onClick={() => onLeadClick(lead)}
            />
          ))
        )}
      </div>
    </section>
  );
}

/* ─────────────── Draggable lead card ─────────────── */

function DraggableLead({
  lead,
  pending,
  onClick,
}: {
  lead: LeadCard;
  pending: boolean;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0 : 1,
  } as React.CSSProperties;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        // Só dispara click se não estava arrastando
        if (!isDragging) onClick();
        e.stopPropagation();
      }}
      className="touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-xl"
    >
      <LeadCardInner lead={lead} pending={pending} />
    </div>
  );
}

function LeadCardInner({
  lead,
  dragging = false,
  pending = false,
}: {
  lead: LeadCard;
  dragging?: boolean;
  pending?: boolean;
}) {
  return (
    <article
      className={cn(
        "group cursor-grab active:cursor-grabbing rounded-xl border bg-white dark:bg-slate-900/40 p-3 transition",
        dragging
          ? "border-accent shadow-elevation-4"
          : "border-gray-200 dark:border-slate-800 shadow-elevation-1 hover:border-accent/40 hover:shadow-elevation-3",
        pending && "opacity-60",
      )}
    >
      <div className="flex items-start gap-2.5">
        <LeadAvatar id={lead.id} name={lead.name} phone={lead.phone_number} className="h-8 w-8" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <h3 className="truncate text-sm font-semibold text-foreground">
                  {lead.name ?? lead.phone_number ?? "Sem nome"}
                </h3>
                {pending ? (
                  <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin text-accent" />
                ) : (
                  <AiSourceBadge source={lead.stage_source} />
                )}
              </div>
              {lead.phone_number && lead.name && (
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {lead.phone_number}
                </p>
              )}
            </div>
            <ScoreBadge score={lead.score} className="shrink-0" />
          </div>

          {lead.briefing?.dor && (
            <p className="mt-2 line-clamp-2 text-[11px] leading-snug text-foreground/75">
              <Sparkles className="mr-1 inline h-3 w-3 text-accent" />
              {lead.briefing.dor}
            </p>
          )}

          <footer className="mt-2.5 flex items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <SentimentBadge sentiment={lead.last_sentiment} />
              <OutcomeBadge category={lead.last_call_outcome_category} />
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Link
                to="/contacts/$contactId"
                params={{ contactId: lead.id }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                title="Ver contato"
                className="rounded p-0.5 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground group-hover:opacity-100"
              >
                <ExternalLink className="h-3 w-3" />
              </Link>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {timeAgo(lead.stage_changed_at ?? lead.last_activity_at)}
              </span>
            </div>
          </footer>
        </div>
      </div>
    </article>
  );
}

/* ─────────────── Lead detail sheet ─────────────── */

function LeadDetail({
  lead,
  stage,
  allStages,
  accountId,
  onMove,
  moving,
}: {
  lead: LeadCard;
  stage: Stage;
  allStages: Stage[];
  accountId: string;
  onMove: (stageId: string, reason?: string) => void;
  moving: boolean;
}) {
  const [loseTarget, setLoseTarget] = useState<Stage | null>(null);

  function handleStageClick(s: Stage) {
    if (s.id === stage.id || moving) return;
    if (s.is_lost) {
      setLoseTarget(s);
      return;
    }
    onMove(s.id);
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle className="text-foreground">
          {lead.name ?? lead.phone_number ?? "Lead"}
        </SheetTitle>
      </SheetHeader>

      <div className="mt-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StageBadge name={stage.name} color={stage.color} />
          <ScoreBadge score={lead.score} />
          <SentimentBadge sentiment={lead.last_sentiment} />
          {lead.source && (
            <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {lead.source}
            </span>
          )}
          <AiSourceBadge source={lead.stage_source} className="ring-1 ring-accent/20" />
        </div>

        {lead.stage_change_reason && (
          <p className="rounded-lg border border-gray-200 dark:border-slate-800 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Motivo do estágio:</span>{" "}
            {lead.stage_change_reason}
          </p>
        )}

        <div className="space-y-2 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-3 text-xs shadow-elevation-1">
          {lead.phone_number && (
            <div className="flex items-center gap-2 text-foreground">
              <Phone className="h-3.5 w-3.5 text-muted-foreground" />
              {lead.phone_number}
            </div>
          )}
          {lead.email && (
            <div className="flex items-center gap-2 text-foreground">
              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
              {lead.email}
            </div>
          )}
          <Link
            to="/contacts/$contactId"
            params={{ contactId: lead.id }}
            className="inline-flex items-center gap-1 pt-0.5 text-[11px] font-medium text-accent hover:underline"
          >
            Ver perfil completo do contato
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>

        <LastInteractionSection accountId={accountId} lead={lead} />

        {lead.briefing && (lead.briefing.dor || lead.briefing.fit || lead.briefing.next_action) && (
          <div className="space-y-3 rounded-xl border border-accent/20 bg-accent/5 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent">
              <Sparkles className="h-3 w-3" />
              Briefing IA
            </div>
            {lead.briefing.dor && <BriefingRow label="Dor" value={lead.briefing.dor} />}
            {lead.briefing.fit && <BriefingRow label="Fit" value={lead.briefing.fit} />}
            {lead.briefing.objections && lead.briefing.objections.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Objeções
                </div>
                <ul className="mt-1 space-y-0.5 text-xs text-foreground/80">
                  {lead.briefing.objections.map((o, i) => (
                    <li key={i}>· {o}</li>
                  ))}
                </ul>
              </div>
            )}
            {lead.briefing.next_action && (
              <BriefingRow label="Próxima ação" value={lead.briefing.next_action} />
            )}
          </div>
        )}

        <RecentCallsSection accountId={accountId} contactId={lead.id} />

        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Mover para outra coluna
          </div>
          <div className="flex flex-wrap gap-1.5">
            {allStages
              .filter((s) => s.id !== stage.id)
              .map((s) => {
                const t = stageTone(s.color);
                return (
                  <button
                    key={s.id}
                    disabled={moving}
                    onClick={() => handleStageClick(s)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium ring-1 transition hover:opacity-80 disabled:pointer-events-none disabled:opacity-50",
                      t.chipBg,
                      t.chipText,
                      t.ring,
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", t.dot)} />
                    {s.name}
                  </button>
                );
              })}
          </div>
        </div>
      </div>

      <LoseReasonDialog
        stage={loseTarget}
        pending={moving}
        onCancel={() => setLoseTarget(null)}
        onConfirm={(reason) => {
          const target = loseTarget;
          setLoseTarget(null);
          if (target) onMove(target.id, reason);
        }}
      />
    </>
  );
}

function BriefingRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xs text-foreground/85">{value}</div>
    </div>
  );
}

/* ─────────────── Última interação (retorno da IA) ─────────────── */

function LastInteractionSection({ accountId, lead }: { accountId: string; lead: LeadCard }) {
  const [expanded, setExpanded] = useState(false);

  const { data: detail, isLoading } = useQuery({
    queryKey: ["call-detail", accountId, lead.last_call_id],
    queryFn: () => fetchCallDetail(accountId, lead.last_call_id!),
    enabled: expanded && !!lead.last_call_id,
  });

  if (!lead.last_call_id) return null;

  return (
    <div className="space-y-2 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <PhoneCall className="h-3 w-3" />
          Última interação
        </div>
        {lead.last_call_direction && (
          <span className="text-[10px] text-muted-foreground">
            {CALL_DIRECTION_LABEL[lead.last_call_direction]}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <OutcomeBadge category={lead.last_call_outcome_category} />
        <span className="text-[11px] text-muted-foreground">
          {formatCallTime(lead.last_call_started_at)}
        </span>
      </div>

      {lead.last_call_outcome_summary && (
        <p className="text-xs leading-relaxed text-foreground/80">
          {lead.last_call_outcome_summary}
        </p>
      )}

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
      >
        {expanded ? "Ocultar detalhes" : "Ver ligação completa"}
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {expanded &&
        (isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : detail ? (
          <div className="space-y-3 border-t border-gray-200 dark:border-slate-800 pt-3">
            <AiSummaryBlock
              accountId={accountId}
              callId={detail.id}
              initial={detail.ai_summary}
              onUpdate={() => {}}
            />
            {detail.recording_url && (
              <audio src={detail.recording_url} controls preload="none" className="w-full" />
            )}
            {detail.transcript.length > 0 && (
              <div className="max-h-[280px] space-y-2 overflow-y-auto pr-1">
                {detail.transcript.map((t) => (
                  <TranscriptTurnRow key={t.index} turn={t} agentName={detail.persona_name ?? "Nina"} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Não foi possível carregar os detalhes.
          </p>
        ))}
    </div>
  );
}

/* ─────────────── Interações recentes ─────────────── */

function RecentCallsSection({ accountId, contactId }: { accountId: string; contactId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["contact-calls", accountId, contactId],
    queryFn: () => fetchCalls(accountId, { contactId, limit: 5 }),
    enabled: !!accountId && !!contactId,
  });

  if (isLoading) return <Skeleton className="h-16 w-full rounded-xl" />;
  if (!data || data.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Interações recentes
        </div>
        <Link
          to="/calls"
          className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
        >
          Ver todas
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
      <div className="space-y-1.5">
        {data.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 px-2.5 py-1.5 text-[11px]"
          >
            <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
              <Phone className="h-3 w-3 shrink-0" />
              <span>{CALL_DIRECTION_LABEL[c.direction]}</span>
              <span>· {formatCallTime(c.started_at)}</span>
            </div>
            <OutcomeBadge category={c.outcome_category} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────── Motivo ao mover para estágio de perda ─────────────── */

function LoseReasonDialog({
  stage,
  pending,
  onCancel,
  onConfirm,
}: {
  stage: Stage | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (stage) setReason("");
  }, [stage]);

  return (
    <Dialog open={!!stage} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mover para "{stage?.name}"</DialogTitle>
          <DialogDescription>
            Registre o motivo da perda — ajuda o time (e a Nina) a entender o funil depois.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ex.: sem orçamento neste momento, já tem fornecedor, número errado…"
          rows={3}
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            Cancelar
          </Button>
          <Button disabled={!reason.trim() || pending} onClick={() => onConfirm(reason.trim())}>
            {pending ? "Movendo…" : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

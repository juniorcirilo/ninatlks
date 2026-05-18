import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Phone,
  Mail,
  Sparkles,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
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
import { supabase } from "@/integrations/supabase/client";
import {
  fetchPipeline,
  moveLeadToStage,
  scoreTone,
  sentimentTone,
  stageTone,
  timeAgo,
  isRecentAutoMove,
  type LeadCard,
  type Pipeline,
  type Stage,
} from "@/lib/pipeline";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

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

function PipelinePage() {
  const { accountId } = useAccount();
  const queryClient = useQueryClient();
  const [selectedLead, setSelectedLead] = useState<{ lead: LeadCard; stage: Stage } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const queryKey = useMemo(() => ["pipeline", accountId] as const, [accountId]);
  const { data, isLoading, error: queryError, refetch } = useQuery({
    queryKey,
    queryFn: () => fetchPipeline(accountId!),
    enabled: !!accountId,
    staleTime: 30_000,
  });

  const loading = isLoading && !data;
  const error = queryError ? (queryError as Error).message : null;
  const refresh = useCallback(async () => { await refetch(); }, [refetch]);

  // Realtime: invalida cache quando a IA muda contatos
  useEffect(() => {
    if (!accountId) return;
    const channel = supabase
      .channel(`pipeline-${accountId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "contacts",
          filter: `account_id=eq.${accountId}`,
        },
        () => queryClient.invalidateQueries({ queryKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId, queryClient, queryKey]);

  const totals = useMemo(() => {
    if (!data) return { leads: 0, won: 0, lost: 0, qualified: 0 };
    let leads = 0, won = 0, lost = 0, qualified = 0;
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

  async function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const leadId = String(e.active.id);
    const targetStageId = e.over ? String(e.over.id) : null;
    if (!targetStageId || !data) return;

    // localizar stage atual
    let sourceStageId: string | null = null;
    let lead: LeadCard | null = null;
    for (const s of data.stages) {
      const l = s.leads.find((x) => x.id === leadId);
      if (l) {
        sourceStageId = s.id;
        lead = l;
        break;
      }
    }
    if (!lead || !sourceStageId || sourceStageId === targetStageId) return;

    // optimistic update
    const prev = data;
    const next: Pipeline = {
      ...data,
      stages: data.stages.map((s) => {
        if (s.id === sourceStageId) return { ...s, leads: s.leads.filter((x) => x.id !== leadId) };
        if (s.id === targetStageId) return { ...s, leads: [{ ...lead!, auto_moved_at: null }, ...s.leads] };
        return s;
      }),
    };
    setData(next);

    try {
      await moveLeadToStage(leadId, targetStageId);
      toast.success("Lead movido");
    } catch (err: any) {
      setData(prev);
      toast.error(err?.message ?? "falha ao mover");
    }
  }

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

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
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-card px-6 py-4">
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
          <span className="hidden items-center gap-1.5 rounded-full border border-accent/20 bg-accent/5 px-2.5 py-1 text-[11px] text-accent sm:inline-flex">
            <Sparkles className="h-3 w-3" />
            Auto-classificação por IA
          </span>
          <Button variant="outline" size="sm" onClick={refresh} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Atualizar
          </Button>
        </div>
      </header>

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
                onLeadClick={(lead) => setSelectedLead({ lead, stage })}
              />
            ))}
          </div>
        </div>

        <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)" }}>
          {activeLead ? (
            <div className="rotate-2 scale-105 opacity-95">
              <LeadCardInner lead={activeLead.lead} dragging />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <Sheet open={!!selectedLead} onOpenChange={(o) => !o && setSelectedLead(null)}>
        <SheetContent className="w-[440px] sm:max-w-[440px]">
          {selectedLead && (
            <LeadDetail
              lead={selectedLead.lead}
              stage={selectedLead.stage}
              allStages={data.stages}
              onMoved={() => {
                setSelectedLead(null);
                refresh();
              }}
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

/* ─────────────── Column (drop target) ─────────────── */

function Column({
  stage,
  onLeadClick,
}: {
  stage: Stage;
  onLeadClick: (lead: LeadCard) => void;
}) {
  const tone = stageTone(stage.color);
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex h-full w-[300px] shrink-0 snap-center flex-col rounded-2xl border bg-card shadow-elevation-1 transition sm:w-[300px]",
        "max-sm:w-[85vw]",
        isOver ? "border-accent ring-2 ring-accent/40 shadow-elevation-3" : "border-border",
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
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
          <div className="flex h-28 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-muted/30 px-3 text-center">
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
              onClick={() => onLeadClick(lead)}
            />
          ))
        )}
      </div>
    </section>
  );
}

/* ─────────────── Draggable lead card ─────────────── */

function DraggableLead({ lead, onClick }: { lead: LeadCard; onClick: () => void }) {
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
      <LeadCardInner lead={lead} />
    </div>
  );
}

function LeadCardInner({ lead, dragging = false }: { lead: LeadCard; dragging?: boolean }) {
  const score = scoreTone(lead.score);
  const sent = sentimentTone(lead.last_sentiment);
  const recentlyAutoMoved = isRecentAutoMove(lead.auto_moved_at);

  return (
    <article
      className={cn(
        "group cursor-grab active:cursor-grabbing rounded-xl border bg-card p-3 transition",
        dragging
          ? "border-accent shadow-elevation-4"
          : "border-border shadow-elevation-1 hover:border-accent/40 hover:shadow-elevation-3",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {lead.name ?? lead.phone_number ?? "Sem nome"}
            </h3>
            {recentlyAutoMoved && (
              <span
                title="Movido pela IA"
                className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-accent/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-accent"
              >
                <Sparkles className="h-2.5 w-2.5" />
                IA
              </span>
            )}
          </div>
          {lead.phone_number && lead.name && (
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {lead.phone_number}
            </p>
          )}
        </div>
        <span
          className={cn(
            "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1 tabular-nums",
            score.cls,
          )}
        >
          {lead.score}
        </span>
      </div>

      {lead.briefing?.dor && (
        <p className="mt-2 line-clamp-2 text-[11px] leading-snug text-foreground/75">
          <Sparkles className="mr-1 inline h-3 w-3 text-accent" />
          {lead.briefing.dor}
        </p>
      )}

      <footer className="mt-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {sent && (
            <span
              title={`Sentimento: ${sent.label}`}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1",
                sent.cls,
              )}
            >
              {lead.last_sentiment === "positive" ? (
                <TrendingUp className="h-2.5 w-2.5" />
              ) : lead.last_sentiment === "negative" ? (
                <TrendingDown className="h-2.5 w-2.5" />
              ) : (
                <Minus className="h-2.5 w-2.5" />
              )}
              {sent.label}
            </span>
          )}
        </div>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {timeAgo(lead.stage_changed_at ?? lead.last_activity_at)}
        </span>
      </footer>
    </article>
  );
}

/* ─────────────── Lead detail sheet ─────────────── */

function LeadDetail({
  lead,
  stage,
  allStages,
  onMoved,
}: {
  lead: LeadCard;
  stage: Stage;
  allStages: Stage[];
  onMoved: () => void;
}) {
  const score = scoreTone(lead.score);
  const tone = stageTone(stage.color);
  const sent = sentimentTone(lead.last_sentiment);

  async function handleMove(stageId: string) {
    if (stageId === stage.id) return;
    try {
      await moveLeadToStage(lead.id, stageId);
      toast.success("Lead movido");
      onMoved();
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao mover");
    }
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
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1",
              tone.chipBg,
              tone.chipText,
              tone.ring,
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />
            {stage.name}
          </span>
          <span
            className={cn(
              "rounded-md px-2 py-0.5 text-[11px] font-medium ring-1",
              score.cls,
            )}
          >
            Score {lead.score} · {score.label}
          </span>
          {sent && (
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-[11px] font-medium ring-1",
                sent.cls,
              )}
            >
              {sent.emoji} {sent.label}
            </span>
          )}
          {lead.source && (
            <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {lead.source}
            </span>
          )}
        </div>

        <div className="space-y-2 rounded-xl border border-border bg-card p-3 text-xs shadow-elevation-1">
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
        </div>

        {lead.briefing &&
          (lead.briefing.dor || lead.briefing.fit || lead.briefing.next_action) && (
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
                    onClick={() => handleMove(s.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium ring-1 transition hover:opacity-80",
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

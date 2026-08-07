import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Calendar as CalendarIcon,
  Phone,
  Mail,
  User as UserIcon,
  Sparkles,
  CheckCircle2,
  X,
  RotateCcw,
  LayoutGrid,
  List,
  CalendarDays,
  Contact,
  Plus,
  Video,
  Copy,
  Search,
} from "lucide-react";
import { useAccount } from "@/lib/account-context";
import { useAuth } from "@/lib/auth-context";
import { useRealtimeRefresh } from "@/lib/realtime-client";
import {
  fetchMeetings,
  formatMeetingTime,
  setMeetingOutcome,
  MEETING_STATUS_LABEL,
  type Meeting,
  type MeetingStatus,
} from "@/lib/meetings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { WeekCalendar, startOfWeek } from "@/components/meetings/WeekCalendar";
import { MeetingsKanban } from "@/components/meetings/MeetingsKanban";
import { PageHeader } from "@/components/layout/PageHeader";
import { DoctorsManager } from "@/components/meetings/DoctorsManager";
import { StatCard } from "@/components/layout/StatCard";
import { GoogleCalendarBanner } from "@/components/meetings/GoogleCalendarBanner";
import { NewMeetingDialog } from "@/components/meetings/NewMeetingDialog";

export const Route = createFileRoute("/_authenticated/reunioes")({
  head: () => ({
    meta: [
      { title: "Reuniões — Nina Talks" },
      {
        name: "description",
        content: "Calendário das reuniões agendadas pela Nina via round-robin com sua equipe.",
      },
    ],
  }),
  component: MeetingsPage,
});

type ViewMode = "calendar" | "kanban" | "list" | "doctors";

const STATUS_FILTERS: MeetingStatus[] = [
  "scheduled",
  "attended",
  "no_show",
  "rescheduled",
  "canceled",
];

function MeetingsPage() {
  const { accountId, role } = useAccount();
  const { user } = useAuth();
  const isAdmin = role === "admin";

  const [data, setData] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("calendar");
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [newMeetingOpen, setNewMeetingOpen] = useState(false);
  const [googleRefreshKey, setGoogleRefreshKey] = useState(0);
  const [statusFilter, setStatusFilter] = useState<Set<MeetingStatus>>(new Set());
  const [query, setQuery] = useState("");

  const refresh = useCallback(async () => {
    if (!accountId) {
      setLoading(false);
      return;
    }
    const start = new Date();
    start.setDate(start.getDate() - 30);
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setDate(end.getDate() + 60);
    end.setHours(23, 59, 59, 999);
    try {
      const m = await fetchMeetings(accountId, start, end);
      setData(m);
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao buscar reuniões");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useRealtimeRefresh(["scheduled_meetings"], accountId, refresh);

  // Toast de retorno do fluxo OAuth do Google (?google_calendar=connected|error).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("google_calendar");
    if (!result) return;
    if (result === "connected") {
      toast.success("Google Meet conectado");
      setGoogleRefreshKey((k) => k + 1);
    } else if (result === "error") {
      toast.error("Não foi possível conectar o Google Meet — tente novamente.");
    }
    params.delete("google_calendar");
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, []);

  // Abre direto a reunião linkada por uma notificação (?meeting=<id>).
  useEffect(() => {
    if (data.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const meetingId = params.get("meeting");
    if (!meetingId) return;
    const found = data.find((m) => m.id === meetingId);
    if (found) setSelected(found);
    params.delete("meeting");
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, [data]);

  const stats = useMemo(() => {
    const now = Date.now();
    let upcoming = 0,
      attended = 0,
      no_show = 0,
      thisWeek = 0;
    const wkStart = startOfWeek(new Date()).getTime();
    const wkEnd = wkStart + 7 * 86400_000;
    for (const m of data) {
      const ts = new Date(m.starts_at).getTime();
      if (m.status === "scheduled" && ts >= now - 30 * 60_000) upcoming++;
      if (m.status === "attended") attended++;
      if (m.status === "no_show") no_show++;
      if (ts >= wkStart && ts < wkEnd) thisWeek++;
    }
    const total = attended + no_show;
    const showRate = total > 0 ? Math.round((attended / total) * 100) : null;
    return { upcoming, attended, no_show, thisWeek, showRate };
  }, [data]);

  const filteredData = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.filter((m) => {
      if (statusFilter.size > 0 && !statusFilter.has(m.status)) return false;
      if (!q) return true;
      return (
        (m.invitee_name ?? "").toLowerCase().includes(q) ||
        (m.invitee_email ?? "").toLowerCase().includes(q) ||
        (m.invitee_phone ?? "").toLowerCase().includes(q) ||
        (m.attendee_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [data, statusFilter, query]);

  const weekMeetings = useMemo(() => {
    const wkEnd = new Date(weekStart);
    wkEnd.setDate(wkEnd.getDate() + 7);
    return filteredData.filter((m) => {
      const ts = new Date(m.starts_at).getTime();
      return ts >= weekStart.getTime() && ts < wkEnd.getTime();
    });
  }, [filteredData, weekStart]);

  function toggleStatus(s: MeetingStatus) {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-7xl px-6 py-6">
        <div className="mb-4 h-16 animate-pulse rounded-xl bg-muted/40" />
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-muted/40" />
          ))}
        </div>
        <div className="h-96 animate-pulse rounded-xl bg-muted/40" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-6">
      <PageHeader
        eyebrow="Agenda"
        title="Reuniões"
        description="Calendário das reuniões agendadas pela Nina via round-robin com a equipe."
        className="mb-4 border-0 px-0 py-0"
        actions={
          isAdmin ? (
            <Button size="sm" onClick={() => setNewMeetingOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" />
              Nova reunião
            </Button>
          ) : undefined
        }
      />

      {accountId && (
        <div className="mb-4">
          <GoogleCalendarBanner accountId={accountId} isAdmin={isAdmin} refreshKey={googleRefreshKey} />
        </div>
      )}

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Próximas" value={String(stats.upcoming)} icon={CalendarIcon} />
        <StatCard label="Esta semana" value={String(stats.thisWeek)} icon={CalendarDays} />
        <StatCard label="Realizadas" value={String(stats.attended)} icon={CheckCircle2} />
        <StatCard
          label="Show rate"
          value={stats.showRate !== null ? `${stats.showRate}%` : "—"}
          delta={`${stats.no_show} no-show${stats.no_show === 1 ? "" : "s"}`}
        />
      </div>

      {/* Filtros */}
      {view !== "doctors" && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar convidado ou host…"
              className="h-8 w-56 pl-8 text-xs"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((s) => {
              const tone = MEETING_STATUS_LABEL[s];
              const active = statusFilter.has(s);
              return (
                <button
                  key={s}
                  onClick={() => toggleStatus(s)}
                  className={cn(
                    "rounded-md px-2 py-1 text-[11px] font-medium ring-1 transition",
                    active ? tone.cls : "text-muted-foreground ring-border hover:bg-muted/50",
                  )}
                >
                  {tone.label}
                </button>
              );
            })}
            {statusFilter.size > 0 && (
              <button
                onClick={() => setStatusFilter(new Set())}
                className="rounded-md px-2 py-1 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
              >
                limpar
              </button>
            )}
          </div>
        </div>
      )}

      {/* View switcher */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
          <ViewBtn
            active={view === "calendar"}
            onClick={() => setView("calendar")}
            icon={CalendarDays}
            label="Calendário"
          />
          <ViewBtn
            active={view === "kanban"}
            onClick={() => setView("kanban")}
            icon={LayoutGrid}
            label="Kanban"
          />
          <ViewBtn
            active={view === "list"}
            onClick={() => setView("list")}
            icon={List}
            label="Lista"
          />
          <ViewBtn
            active={view === "doctors"}
            onClick={() => setView("doctors")}
            icon={Contact}
            label="Contatos"
          />
        </div>
        <div className="text-[11px] text-muted-foreground">
          {view === "doctors"
            ? "Configure com quem a Nina pode marcar reuniões"
            : `${filteredData.length} ${filteredData.length === 1 ? "reunião" : "reuniões"} no período`}
        </div>
      </div>

      {view === "doctors" && accountId && <DoctorsManager accountId={accountId} />}

      {view === "calendar" && (
        <WeekCalendar
          meetings={weekMeetings}
          weekStart={weekStart}
          onWeekChange={setWeekStart}
          onMeetingClick={setSelected}
        />
      )}

      {view === "kanban" && <MeetingsKanban meetings={filteredData} onCardClick={setSelected} />}

      {view === "list" && <ListView meetings={filteredData} onSelect={setSelected} />}

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-[480px] sm:max-w-[480px]">
          {selected && (
            <MeetingDetail
              meeting={selected}
              onChanged={() => {
                setSelected(null);
                refresh();
              }}
            />
          )}
        </SheetContent>
      </Sheet>

      {accountId && (
        <NewMeetingDialog
          open={newMeetingOpen}
          accountId={accountId}
          currentUserId={user?.id ?? null}
          onClose={() => setNewMeetingOpen(false)}
          onCreated={() => {
            setNewMeetingOpen(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function ViewBtn({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function ListView({ meetings, onSelect }: { meetings: Meeting[]; onSelect: (m: Meeting) => void }) {
  const sorted = useMemo(
    () => [...meetings].sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [meetings],
  );

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card py-16 text-center">
        <CalendarIcon className="mb-2 h-5 w-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Nenhuma reunião no período.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Crie uma reunião ou aguarde a Nina agendar com um lead.
        </p>
      </div>
    );
  }

  // Group by day
  const groups = new Map<string, Meeting[]>();
  for (const m of sorted) {
    const key = new Date(m.starts_at).toDateString();
    const arr = groups.get(key) ?? [];
    arr.push(m);
    groups.set(key, arr);
  }

  return (
    <div className="space-y-4">
      {Array.from(groups.entries()).map(([day, items]) => {
        const d = new Date(day);
        const isToday = d.toDateString() === new Date().toDateString();
        return (
          <div key={day}>
            <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              <span className={cn(isToday && "font-semibold text-primary")}>
                {new Intl.DateTimeFormat("pt-BR", {
                  weekday: "long",
                  day: "2-digit",
                  month: "long",
                }).format(d)}
              </span>
              {isToday && (
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                  hoje
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              {items.map((m) => (
                <MeetingRow key={m.id} meeting={m} onClick={() => onSelect(m)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MeetingRow({ meeting, onClick }: { meeting: Meeting; onClick: () => void }) {
  const tone = MEETING_STATUS_LABEL[meeting.status];
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-4 rounded-xl border border-border bg-card px-4 py-3 text-left transition hover:border-primary/40 hover:shadow-sm"
    >
      <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-primary/10 text-center">
        <div className="text-[9px] uppercase tracking-wider text-primary/70">
          {new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(new Date(meeting.starts_at))}
        </div>
        <div className="text-sm font-semibold text-primary">
          {new Intl.DateTimeFormat("pt-BR", { day: "2-digit" }).format(new Date(meeting.starts_at))}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {meeting.invitee_name ?? meeting.invitee_phone ?? "Lead"}
          </span>
          <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1", tone.cls)}>
            {tone.label}
          </span>
          {meeting.meeting_url && (
            <Video className="h-3 w-3 shrink-0 text-primary" aria-label="Tem link de vídeo" />
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          <span>
            {new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(
              new Date(meeting.starts_at),
            )}
            {meeting.duration_minutes ? ` · ${meeting.duration_minutes}min` : ""}
          </span>
          {meeting.attendee_name && (
            <span className="flex items-center gap-1">
              <UserIcon className="h-3 w-3" />
              {meeting.attendee_name}
            </span>
          )}
          {meeting.briefing?.dor && (
            <span className="flex items-center gap-1 text-primary">
              <Sparkles className="h-3 w-3" />
              {meeting.briefing.dor.slice(0, 60)}
              {meeting.briefing.dor.length > 60 ? "…" : ""}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function MeetingDetail({ meeting, onChanged }: { meeting: Meeting; onChanged: () => void }) {
  const { accountId } = useAccount();
  const tone = MEETING_STATUS_LABEL[meeting.status];
  const [notes, setNotes] = useState(meeting.notes ?? "");
  const [savingStatus, setSavingStatus] = useState<MeetingStatus | null>(null);

  async function applyStatus(status: MeetingStatus, cancellationReason?: string) {
    if (!accountId) return;
    setSavingStatus(status);
    try {
      await setMeetingOutcome(accountId, meeting.id, status, {
        notes: notes !== meeting.notes ? notes : undefined,
        cancellationReason,
      });
      toast.success("Status atualizado");
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao atualizar");
    } finally {
      setSavingStatus(null);
    }
  }

  function copyLink() {
    if (!meeting.meeting_url) return;
    navigator.clipboard.writeText(meeting.meeting_url);
    toast.success("Link copiado");
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>{meeting.invitee_name ?? meeting.invitee_phone ?? "Reunião"}</SheetTitle>
      </SheetHeader>

      <div className="mt-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-medium ring-1", tone.cls)}>
            {tone.label}
          </span>
          <span className="text-xs text-foreground">{formatMeetingTime(meeting.starts_at)}</span>
          {meeting.duration_minutes && (
            <span className="text-[11px] text-muted-foreground">
              · {meeting.duration_minutes} min
            </span>
          )}
        </div>

        {meeting.meeting_url && (
          <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/[0.04] p-3">
            <Video className="h-4 w-4 shrink-0 text-primary" />
            <a
              href={meeting.meeting_url}
              target="_blank"
              rel="noreferrer"
              className="flex-1 truncate text-xs font-medium text-primary hover:underline"
            >
              Entrar na reunião (Google Meet)
            </a>
            <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={copyLink}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        <div className="space-y-2 rounded-xl border border-border bg-card p-3 text-xs">
          {meeting.invitee_phone && (
            <Row icon={<Phone className="h-3.5 w-3.5 text-muted-foreground" />}>
              {meeting.invitee_phone}
            </Row>
          )}
          {meeting.invitee_email && (
            <Row icon={<Mail className="h-3.5 w-3.5 text-muted-foreground" />}>
              {meeting.invitee_email}
            </Row>
          )}
          {meeting.attendee_name && (
            <Row icon={<UserIcon className="h-3.5 w-3.5 text-muted-foreground" />}>
              Conduzido por{" "}
              <span className="font-medium text-foreground">{meeting.attendee_name}</span>
            </Row>
          )}
        </div>

        {meeting.briefing &&
          (meeting.briefing.dor || meeting.briefing.fit || meeting.briefing.next_action) && (
            <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/[0.04] p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
                <Sparkles className="h-3 w-3" />
                Briefing IA
              </div>
              {meeting.briefing.dor && <Field label="Dor" value={meeting.briefing.dor} />}
              {meeting.briefing.fit && <Field label="Fit" value={meeting.briefing.fit} />}
              {meeting.briefing.objections && meeting.briefing.objections.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Objeções
                  </div>
                  <ul className="mt-1 space-y-0.5 text-xs text-foreground">
                    {meeting.briefing.objections.map((o, i) => (
                      <li key={i}>· {o}</li>
                    ))}
                  </ul>
                </div>
              )}
              {meeting.briefing.next_action && (
                <Field label="Próxima ação" value={meeting.briefing.next_action} />
              )}
            </div>
          )}

        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Suas notas
          </div>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Escreva o que você sentiu durante a reunião…"
          />
        </div>

        {meeting.status === "scheduled" && (
          <div>
            <div className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              Marcar como
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant="outline"
                disabled={!!savingStatus}
                onClick={() => applyStatus("attended")}
                className="gap-1.5"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                Realizada
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!!savingStatus}
                onClick={() => applyStatus("no_show")}
                className="gap-1.5"
              >
                <X className="h-3.5 w-3.5 text-rose-500" />
                No-show
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!!savingStatus}
                onClick={() => applyStatus("rescheduled")}
                className="gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5 text-primary" />
                Remarcada
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!!savingStatus}
                onClick={() => applyStatus("canceled", "manual")}
                className="text-muted-foreground"
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {meeting.cancellation_reason && (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.04] p-3 text-xs text-rose-600 dark:text-rose-300">
            <div className="text-[10px] uppercase tracking-wider opacity-70">
              Motivo do cancelamento
            </div>
            <div className="mt-0.5">{meeting.cancellation_reason}</div>
          </div>
        )}
      </div>
    </>
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
      <div className="mt-0.5 text-xs text-foreground">{value}</div>
    </div>
  );
}

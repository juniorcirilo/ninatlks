import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Users,
  PhoneCall,
  CalendarDays,
  TrendingUp,
  TrendingDown,
  Activity,
  Sparkles,
  CheckCircle2,
  Loader2,
  ArrowUpRight,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useAccount } from "@/lib/account-context";
import { fetchSdrSnapshot, formatSentiment, type SdrSnapshot } from "@/lib/dashboard-sdr";
import { stageTone } from "@/lib/pipeline";
import { formatMeetingTime } from "@/lib/meetings";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Painel — Nina Talks" },
      {
        name: "description",
        content: "Visão geral do agente Nina: leads, calls, reuniões e funil.",
      },
    ],
  }),
  component: DashboardPage,
});

function sentimentToken(score: number | null): string {
  if (score == null) return "text-muted-foreground";
  if (score > 0.15) return "text-success";
  if (score < -0.15) return "text-destructive";
  return "text-foreground";
}

function DashboardPage() {
  const { user } = useAuth();
  const { accountId, loading: accountLoading } = useAccount();
  const [data, setData] = useState<SdrSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (accountLoading) return;
    if (!accountId) {
      setLoading(false);
      setError("Workspace não encontrado. Complete o onboarding ou peça um convite.");
      return;
    }
    setLoading(true);
    setError(null);
    fetchSdrSnapshot(accountId)
      .then((snap) => {
        setData(snap);
        setError(null);
      })
      .catch((e) => {
        console.error("[painel] fetchSdrSnapshot failed", e);
        setError(e?.message ?? "Falha ao carregar painel.");
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [accountId, accountLoading]);

  const firstName = (user?.displayName ?? user?.name)?.split(" ")[0] ?? "tudo bem";

  return (
    <div className="w-full px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Olá, {firstName}.</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Nina Talks · agente de SDR por voz. Atende, qualifica, agenda e entrega briefing.
        </p>
      </header>

      {loading || accountLoading ? (
        <div className="flex h-[40vh] items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : error || !data ? (
        <div className="rounded-2xl border border-warning/40 bg-warning/10 p-6 text-sm font-medium text-foreground shadow-elevation-1">
          {error ?? "Não foi possível carregar o painel."}
        </div>
      ) : (
        <>
          {/* KPI grid */}
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi
              label="Leads novos hoje"
              value={data.leads_today}
              hint={`${data.leads_week} na semana · ${data.leads_total} no total`}
              icon={Users}
            />
            <Kpi
              label="Chamadas hoje"
              value={data.calls_today}
              hint={`${data.calls_week} na semana`}
              icon={PhoneCall}
            />
            <Kpi
              label="Reuniões na semana"
              value={data.meetings_upcoming}
              hint={
                data.attendance_rate_week != null
                  ? `Comparecimento ${data.attendance_rate_week.toFixed(0)}%`
                  : "Sem comparecimentos no histórico"
              }
              icon={CalendarDays}
            />
            <Kpi
              label="Sentimento médio"
              value={formatSentiment(data.avg_sentiment_week)}
              hint={
                data.positive_pct_week != null
                  ? `${data.positive_pct_week.toFixed(0)}% positivas`
                  : "Sem calls com transcript"
              }
              icon={Activity}
              valueClass={sentimentToken(data.avg_sentiment_week)}
            />
          </section>

          {/* Pipeline funnel */}
          <section className="mt-8">
            <SectionHeader
              title="Funil de leads"
              cta={
                <Link
                  to="/pipeline"
                  className="flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                >
                  Ver Kanban
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              }
            />
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {data.pipeline.map((s) => (
                <StageCard
                  key={s.stage_id}
                  name={s.stage_name}
                  count={s.count}
                  color={s.color}
                  isWon={s.is_won}
                  isLost={s.is_lost}
                />
              ))}
            </div>
          </section>

          {/* Reuniões + Outcomes da semana */}
          <section className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <SectionHeader
                title="Próximas reuniões"
                cta={
                  <Link
                    to="/reunioes"
                    className="flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                  >
                    Ver todas
                    <ArrowUpRight className="h-3 w-3" />
                  </Link>
                }
              />
              <div className="mt-3 space-y-2">
                {data.upcoming_meetings.length === 0 ? (
                  <EmptyCard text="Nenhuma reunião nos próximos 7 dias." />
                ) : (
                  data.upcoming_meetings.map((m) => <UpcomingMeetingRow key={m.id} meeting={m} />)
                )}
              </div>
            </div>

            <div>
              <SectionHeader title="Comparecimento (7d)" />
              <div className="mt-3 space-y-2">
                <OutcomeRow
                  label="Realizadas"
                  value={data.meetings_attended_week}
                  icon={CheckCircle2}
                  tone="text-success"
                />
                <OutcomeRow
                  label="No-show"
                  value={data.meetings_no_show_week}
                  icon={TrendingDown}
                  tone="text-destructive"
                />
                <OutcomeRow
                  label="Taxa"
                  value={
                    data.attendance_rate_week != null
                      ? `${data.attendance_rate_week.toFixed(0)}%`
                      : "—"
                  }
                  icon={TrendingUp}
                  tone={
                    data.attendance_rate_week != null && data.attendance_rate_week >= 70
                      ? "text-success"
                      : "text-warning"
                  }
                />
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  icon: Icon,
  valueClass,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  valueClass?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-elevation-2 transition-shadow hover:shadow-elevation-3">
      <div className="flex items-start justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className={cn("mt-3 text-2xl font-semibold tracking-tight text-foreground", valueClass)}>
        {value}
      </div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function SectionHeader({ title, cta }: { title: string; cta?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
      {cta}
    </div>
  );
}

function StageCard({
  name,
  count,
  color,
  isWon,
  isLost,
}: {
  name: string;
  count: number;
  color: string;
  isWon: boolean;
  isLost: boolean;
}) {
  const tone = stageTone(color);
  return (
    <Link
      to="/pipeline"
      className={cn(
        "rounded-xl border bg-card p-3 shadow-elevation-1 transition hover:border-accent/40 hover:shadow-elevation-2",
        isWon ? "border-success/40" : isLost ? "border-destructive/40" : "border-border",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />
        <span className="truncate text-[11px] text-muted-foreground">{name}</span>
      </div>
      <div className="mt-2 text-xl font-semibold text-foreground">{count}</div>
    </Link>
  );
}

function UpcomingMeetingRow({ meeting }: { meeting: SdrSnapshot["upcoming_meetings"][number] }) {
  return (
    <Link
      to="/reunioes"
      className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-elevation-1 transition hover:border-accent/40 hover:bg-accent/5 hover:shadow-elevation-2"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-center">
        <CalendarDays className="h-4 w-4 text-accent" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {meeting.invitee_name ?? meeting.invitee_phone ?? "Lead"}
          </span>
          {meeting.confirmed && (
            <span className="rounded-md bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success ring-1 ring-success/30">
              <Sparkles className="mr-0.5 inline h-3 w-3" />
              Confirmada
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {formatMeetingTime(meeting.starts_at)}
          {meeting.attendee_name && <> · com {meeting.attendee_name}</>}
        </div>
      </div>
    </Link>
  );
}

function OutcomeRow({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2.5 shadow-elevation-1">
      <div className="flex items-center gap-2">
        <Icon className={cn("h-3.5 w-3.5", tone)} />
        <span className="text-xs font-medium text-foreground/80">{label}</span>
      </div>
      <span className={cn("text-sm font-semibold", tone)}>{value}</span>
    </div>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-6 text-center text-xs text-muted-foreground">
      {text}
    </div>
  );
}

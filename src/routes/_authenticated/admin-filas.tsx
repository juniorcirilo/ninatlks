import React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  Clock,
  ListChecks,
  Phone,
  PhoneCall,
  PhoneForwarded,
  PhoneOff,
  Radar,
  RefreshCw,
  TrendingUp,
  Users,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CAMPAIGN_KIND_LABEL, CAMPAIGN_STATUS_LABEL } from "@/lib/campaigns";
import {
  getQueueSummary,
  listFailedDispatch,
  listActiveCampaignsQueue,
  listEscalatedCalls,
  type QueueSummary,
  type FailedCampaignContactRow,
  type CampaignQueueRow,
  type EscalatedCallRow,
} from "@/lib/admin-queues.functions";

export const Route = createFileRoute("/_authenticated/admin-filas")({
  head: () => ({
    meta: [{ title: "Filas e processamento — Nina Talks" }],
  }),
  component: AdminFilasPage,
});

function formatRelative(iso: string | null) {
  if (!iso) return "—";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR });
  } catch {
    return iso;
  }
}

function AdminFilasPage() {
  const fetchSummary = useServerFn(getQueueSummary);
  const fetchFailed = useServerFn(listFailedDispatch);
  const fetchActiveCampaigns = useServerFn(listActiveCampaignsQueue);
  const fetchEscalated = useServerFn(listEscalatedCalls);

  const summary = useQuery({
    queryKey: ["admin", "queues", "summary"],
    queryFn: () => fetchSummary(),
    refetchInterval: 15_000,
  });

  const activeCampaigns = useQuery({
    queryKey: ["admin", "queues", "active-campaigns"],
    queryFn: () => fetchActiveCampaigns(),
    refetchInterval: 15_000,
  });

  const failed = useQuery({
    queryKey: ["admin", "queues", "failed-dispatch"],
    queryFn: () => fetchFailed(),
    refetchInterval: 30_000,
  });

  const escalated = useQuery({
    queryKey: ["admin", "queues", "escalated"],
    queryFn: () => fetchEscalated(),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Filas e processamento"
        description="Monitor em tempo real da discagem de campanhas, follow-ups, listas operacionais e webhooks."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void summary.refetch();
              void activeCampaigns.refetch();
              void failed.refetch();
              void escalated.refetch();
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Atualizar
          </Button>
        }
      />

      {(summary.isError || activeCampaigns.isError || failed.isError) && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center justify-between gap-4 p-4 text-sm">
            <span className="text-destructive">
              Falha ao carregar dados das filas
              {summary.error instanceof Error
                ? `: ${summary.error.message}`
                : activeCampaigns.error instanceof Error
                  ? `: ${activeCampaigns.error.message}`
                  : failed.error instanceof Error
                    ? `: ${failed.error.message}`
                    : "."}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void summary.refetch();
                void activeCampaigns.refetch();
                void failed.refetch();
                void escalated.refetch();
              }}
            >
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      )}

      <SummaryGrid data={summary.data} loading={summary.isLoading} />

      <CampaignQueueBoard data={activeCampaigns.data} loading={activeCampaigns.isLoading} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PhoneForwarded className="h-4 w-4 text-violet-500" />
            Chamadas escaladas — transferidas para humano (últimas 50)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <EscalatedCallsTable data={escalated.data ?? []} loading={escalated.isLoading} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-warning" />
            Contatos de campanha com falha ou pendentes (últimas 50)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <FailedDispatchTable data={failed.data ?? []} loading={failed.isLoading} />
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryGrid({ data, loading }: { data: QueueSummary | undefined; loading: boolean }) {
  if (loading || !data || !data.campaignDispatch || !data.followUps || !data.sources || !data.webhooks) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <QueueCard
        icon={<Phone className="h-4 w-4" />}
        title="Discagem de campanha"
        primary={data.campaignDispatch.pending}
        primaryLabel="pendentes"
        rows={[
          { label: "Em execução", value: data.campaignDispatch.inFlight },
          {
            label: "Falhas",
            value: data.campaignDispatch.failed,
            danger: data.campaignDispatch.failed > 0,
          },
          { label: "Mais antiga", value: formatRelative(data.campaignDispatch.oldestPendingAt) },
          { label: "Tentativas médias", value: data.campaignDispatch.avgAttempts.toFixed(1) },
        ]}
      />
      <QueueCard
        icon={<Clock className="h-4 w-4" />}
        title="Follow-ups (cadências)"
        primary={data.followUps.pending}
        primaryLabel="pendentes"
        rows={[
          { label: "Concluídos 24h", value: data.followUps.completed24h },
          { label: "Falhas", value: data.followUps.failed, danger: data.followUps.failed > 0 },
          { label: "Próximo disparo", value: formatRelative(data.followUps.nextDueAt) },
        ]}
      />
      <QueueCard
        icon={<ListChecks className="h-4 w-4" />}
        title="Listas operacionais"
        primary={data.sources.due}
        primaryLabel="vencidas"
        rows={[
          { label: "Fontes ativas", value: data.sources.active },
          {
            label: "Falhas (última execução)",
            value: data.sources.failedLastRun,
            danger: data.sources.failedLastRun > 0,
          },
          { label: "Última sincronização", value: formatRelative(data.sources.lastSyncAt) },
        ]}
      />
      <QueueCard
        icon={<Activity className="h-4 w-4" />}
        title="Webhooks (24h)"
        primary={data.webhooks.delivered24h}
        primaryLabel="entregues"
        rows={[
          { label: "Falhas (4xx/5xx)", value: data.webhooks.failed24h, danger: data.webhooks.failed24h > 0 },
          {
            label: "Taxa de sucesso",
            value:
              data.webhooks.delivered24h + data.webhooks.failed24h === 0
                ? "—"
                : `${Math.round(
                    (data.webhooks.delivered24h /
                      (data.webhooks.delivered24h + data.webhooks.failed24h)) *
                      100,
                  )}%`,
          },
        ]}
      />
    </div>
  );
}

function QueueCard({
  icon,
  title,
  primary,
  primaryLabel,
  rows,
}: {
  icon: React.ReactNode;
  title: string;
  primary: number | string;
  primaryLabel: string;
  rows: Array<{ label: string; value: string | number; danger?: boolean }>;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums">{primary}</span>
          <span className="text-xs uppercase tracking-wide text-muted-foreground">{primaryLabel}</span>
        </div>
        <dl className="space-y-1.5 text-xs">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd
                className={
                  row.danger
                    ? "font-medium text-destructive tabular-nums"
                    : "font-medium tabular-nums"
                }
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

const STATUS_PILL_CLASS: Record<string, string> = {
  running: "bg-emerald-500/15 text-emerald-600 ring-emerald-500/30 dark:text-emerald-400",
  paused: "bg-amber-500/15 text-amber-600 ring-amber-500/30 dark:text-amber-400",
  scheduled: "bg-sky-500/15 text-sky-600 ring-sky-500/30 dark:text-sky-400",
};

/** Segmentos do ribbon, na ordem em que a fila realmente flui. */
const RIBBON_SEGMENTS: Array<{
  key: keyof Pick<
    CampaignQueueRow,
    "queued" | "inFlight" | "connected" | "escalated" | "voicemail" | "failed" | "canceled"
  >;
  label: string;
  className: string;
}> = [
  { key: "queued", label: "Na fila", className: "bg-muted-foreground/25" },
  { key: "inFlight", label: "Ligando agora", className: "bg-sky-500" },
  { key: "connected", label: "Atendeu", className: "bg-emerald-500" },
  { key: "escalated", label: "Transferido", className: "bg-violet-500" },
  { key: "voicemail", label: "Caixa postal", className: "bg-amber-500" },
  { key: "failed", label: "Não atendeu / falhou", className: "bg-rose-500" },
  { key: "canceled", label: "Cancelado", className: "bg-muted-foreground/50" },
];

function LiveDot() {
  return (
    <span className="relative flex h-1.5 w-1.5">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
    </span>
  );
}

/**
 * Painel ao vivo: uma campanha por card, com o ribbon de fila (para onde
 * cada contato foi) e o par que a operação realmente acompanha —
 * atendeu vs. resposta positiva — em destaque.
 */
function CampaignQueueBoard({
  data,
  loading,
}: {
  data: CampaignQueueRow[] | undefined;
  loading: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Radar className="h-4 w-4 text-primary" />
        <h2 className="text-base font-semibold">Campanhas em execução</h2>
        {!loading && data && data.length > 0 && (
          <Badge variant="secondary" className="tabular-nums">
            {data.length}
          </Badge>
        )}
      </div>

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Nenhuma campanha em execução, pausada ou agendada no momento.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.map((c) => (
            <CampaignQueueCard key={c.id} data={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function CampaignQueueCard({ data: c }: { data: CampaignQueueRow }) {
  const total = Math.max(c.totalContacts, 1);
  const positiveRate = c.connected > 0 ? Math.round((c.positive / c.connected) * 100) : null;

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {c.status === "running" && <span className="text-emerald-500"><LiveDot /></span>}
              <h3 className="truncate text-sm font-semibold">{c.name}</h3>
            </div>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="h-3 w-3" />
              {c.totalContacts.toLocaleString("pt-BR")} na lista
              {c.kind && (
                <>
                  <span>·</span>
                  <span>{CAMPAIGN_KIND_LABEL[c.kind as keyof typeof CAMPAIGN_KIND_LABEL] ?? c.kind}</span>
                </>
              )}
            </p>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
              STATUS_PILL_CLASS[c.status] ?? "bg-muted text-muted-foreground ring-border",
            )}
          >
            {CAMPAIGN_STATUS_LABEL[c.status] ?? c.status}
          </span>
        </div>

        <div
          className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
          title={RIBBON_SEGMENTS.map((s) => `${s.label}: ${c[s.key]}`).join(" · ")}
        >
          {RIBBON_SEGMENTS.map((s) => {
            const value = c[s.key];
            if (value <= 0) return null;
            return (
              <div
                key={s.key}
                className={s.className}
                style={{ width: `${(value / total) * 100}%` }}
              />
            );
          })}
        </div>

        <div className="grid grid-cols-5 gap-2">
          <Stat icon={PhoneOff} label="Restam" value={c.queued} />
          <Stat icon={PhoneCall} label="Ligando" value={c.inFlight} live={c.inFlight > 0} />
          <Stat icon={Phone} label="Atendeu" value={c.connected} />
          <Stat icon={ArrowRightLeft} label="Transferiu" value={c.escalated} escalated={c.escalated > 0} />
          <Stat
            icon={TrendingUp}
            label="Positivas"
            value={c.positive}
            sub={positiveRate !== null ? `${positiveRate}% das atendidas` : undefined}
            accent
          />
        </div>

        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{c.startedAt ? `Iniciada ${formatRelative(c.startedAt)}` : "Aguardando início"}</span>
          {c.nextAttemptAt && <span>Próxima tentativa {formatRelative(c.nextAttemptAt)}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  accent,
  escalated,
  live,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  sub?: string;
  accent?: boolean;
  escalated?: boolean;
  live?: boolean;
}) {
  const colorClass = accent
    ? "text-emerald-600 dark:text-emerald-400"
    : escalated
      ? "text-violet-600 dark:text-violet-400"
      : "text-foreground";
  const bgClass = accent
    ? "bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/25"
    : escalated
      ? "bg-violet-500/10 ring-1 ring-inset ring-violet-500/25"
      : "bg-muted/40";

  return (
    <div className={cn("rounded-lg px-1.5 py-2 text-center", bgClass)}>
      <div className="flex items-center justify-center gap-1">
        <Icon className={cn("h-3 w-3", accent ? "text-emerald-600" : escalated ? "text-violet-500" : "text-muted-foreground")} />
        {live && (
          <span className="text-sky-500">
            <LiveDot />
          </span>
        )}
      </div>
      <div className={cn("text-lg font-semibold tabular-nums", colorClass)}>
        {value.toLocaleString("pt-BR")}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      {sub && (
        <div className={cn("truncate text-[10px] font-medium", colorClass)}>
          {sub}
        </div>
      )}
    </div>
  );
}

const ESCALATION_REASON_LABEL: Record<string, string> = {
  solicitou_humano: "Pediu humano",
  reclamacao: "Reclamação",
  negociacao_complexa: "Negociação complexa",
  wrong_number: "Número errado",
  escalated: "Escalado",
};

function EscalatedCallsTable({
  data,
  loading,
}: {
  data: EscalatedCallRow[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        Nenhuma chamada escalada registrada.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="p-3 font-medium">Campanha</th>
            <th className="p-3 font-medium">Telefone</th>
            <th className="p-3 font-medium">Transferido para</th>
            <th className="p-3 font-medium">Motivo</th>
            <th className="p-3 font-medium">Tentativas</th>
            <th className="p-3 font-medium">Quando</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.id} className="border-b last:border-0 hover:bg-muted/20">
              <td className="p-3">
                <Badge variant="outline" className="font-mono text-[10px] uppercase">
                  {row.campaignName}
                </Badge>
              </td>
              <td className="p-3 tabular-nums">{row.phoneNumber}</td>
              <td className="p-3">
                {row.transferTarget ? (
                  <span className="flex items-center gap-1.5 font-medium tabular-nums">
                    <PhoneForwarded className="h-3.5 w-3.5 text-violet-500" />
                    {row.transferTarget}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="p-3">
                {row.escalationReason ? (
                  <Badge variant="secondary" className="text-[10px]">
                    {ESCALATION_REASON_LABEL[row.escalationReason] ?? row.escalationReason}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="p-3 tabular-nums">{row.attempts}</td>
              <td className="p-3 text-xs text-muted-foreground">
                {formatRelative(row.updatedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FailedDispatchTable({
  data,
  loading,
}: {
  data: FailedCampaignContactRow[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        Nenhum contato de campanha com falha ou pendente. ✨
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="p-3 font-medium">Campanha</th>
            <th className="p-3 font-medium">Telefone</th>
            <th className="p-3 font-medium">Status</th>
            <th className="p-3 font-medium">Tentativas</th>
            <th className="p-3 font-medium">Próx. tentativa</th>
            <th className="p-3 font-medium">Erro</th>
            <th className="p-3 font-medium">Criado</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.id} className="border-b last:border-0">
              <td className="p-3">
                <Badge variant="outline" className="font-mono text-[10px] uppercase">
                  {row.campaignName}
                </Badge>
              </td>
              <td className="p-3 tabular-nums">{row.phoneNumber}</td>
              <td className="p-3">
                <Badge variant={row.status === "failed" ? "destructive" : "secondary"}>
                  {row.status}
                </Badge>
              </td>
              <td className="p-3 tabular-nums">{row.attempts}</td>
              <td className="p-3 text-xs text-muted-foreground">
                {formatRelative(row.nextAttemptAt)}
              </td>
              <td className="p-3 max-w-md truncate text-xs text-destructive" title={row.lastError ?? ""}>
                {row.lastError ?? "—"}
              </td>
              <td className="p-3 text-xs text-muted-foreground">
                {formatRelative(row.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

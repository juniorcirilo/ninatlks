import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, AlertTriangle, Clock, Mail, RefreshCw, Workflow } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getQueueSummary,
  listFailedDispatch,
  type QueueSummary,
  type DispatchQueueRow,
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

  const summary = useQuery({
    queryKey: ["admin", "queues", "summary"],
    queryFn: () => fetchSummary(),
    refetchInterval: 15_000,
  });

  const failed = useQuery({
    queryKey: ["admin", "queues", "failed-dispatch"],
    queryFn: () => fetchFailed(),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Filas e processamento"
        description="Monitor em tempo real das filas de mensagens, follow-ups, workflows e webhooks."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void summary.refetch();
              void failed.refetch();
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Atualizar
          </Button>
        }
      />

      {(summary.isError || failed.isError) && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center justify-between gap-4 p-4 text-sm">
            <span className="text-destructive">
              Falha ao carregar dados das filas
              {summary.error instanceof Error
                ? `: ${summary.error.message}`
                : failed.error instanceof Error
                  ? `: ${failed.error.message}`
                  : "."}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void summary.refetch();
                void failed.refetch();
              }}
            >
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      )}

      <SummaryGrid data={summary.data} loading={summary.isLoading} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-warning" />
            Mensagens com falha ou pendentes (últimas 50)
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
  if (loading || !data || !data.dispatch || !data.followUps || !data.workflows || !data.webhooks) {
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
        icon={<Mail className="h-4 w-4" />}
        title="Envio de mensagens"
        primary={data.dispatch.pending}
        primaryLabel="pendentes"
        rows={[
          { label: "Em execução", value: data.dispatch.inFlight },
          { label: "Falhas", value: data.dispatch.failed, danger: data.dispatch.failed > 0 },
          { label: "Mais antiga", value: formatRelative(data.dispatch.oldestPendingAt) },
          { label: "Tentativas médias", value: data.dispatch.avgAttempts.toFixed(1) },
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
        icon={<Workflow className="h-4 w-4" />}
        title="Workflows"
        primary={data.workflows.pending}
        primaryLabel="pendentes"
        rows={[
          { label: "Concluídos 24h", value: data.workflows.succeeded24h },
          { label: "Falhas 24h", value: data.workflows.failed24h, danger: data.workflows.failed24h > 0 },
          {
            label: "Duração média",
            value: data.workflows.avgDurationMs == null ? "—" : `${data.workflows.avgDurationMs} ms`,
          },
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

function FailedDispatchTable({ data, loading }: { data: DispatchQueueRow[]; loading: boolean }) {
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
        Nenhuma mensagem com falha ou pendente. ✨
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="p-3 font-medium">Canal</th>
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
                  {row.channelType}
                </Badge>
              </td>
              <td className="p-3">
                <Badge variant={row.status === "failed" ? "destructive" : "secondary"}>
                  {row.status}
                </Badge>
              </td>
              <td className="p-3 tabular-nums">
                {row.attempts}/{row.maxAttempts}
              </td>
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

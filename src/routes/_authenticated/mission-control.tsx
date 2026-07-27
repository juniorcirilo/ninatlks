// Mission Control — cockpit executivo em tempo real.
// Auto-refresh 10s + realtime listener em agent_handoffs pra pulsar a feed.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Inbox,
  Clock,
  AlarmClock,
  ArrowRightLeft,
  CalendarCheck,
  MessageSquare,
  ArrowDownLeft,
  ArrowUpRight,
  Users,
  Bot,
  Radio,
  Flame,
  Loader2,
  Zap,
  UserRound,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAccount } from "@/lib/account-context";
import { subscribeTable } from "@/lib/realtime-client";
import {
  getMissionControlSnapshot,
  type MissionControlSnapshot,
} from "@/lib/mission-control.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/mission-control")({
  head: () => ({
    meta: [
      { title: "Mission Control — Nexus" },
      {
        name: "description",
        content: "Cockpit executivo em tempo real: conversas, handoffs, Funcionários IA, SLA.",
      },
    ],
  }),
  component: MissionControlPage,
});

const REFRESH_MS = 10_000;

function MissionControlPage() {
  const { accountId } = useAccount();
  const queryClient = useQueryClient();
  const [pulse, setPulse] = useState(false);

  const queryKey = useMemo(() => ["mission-control", accountId] as const, [accountId]);
  const { data: snap, isLoading } = useQuery({
    queryKey,
    queryFn: async (): Promise<MissionControlSnapshot> => {
      try {
        return await getMissionControlSnapshot(accountId!);
      } catch (err) {
        console.error("[mission-control] snapshot fetch failed:", err);
        return {
          generated_at: new Date().toISOString(),
          kpis: {
            open_conversations: 0,
            pending_conversations: 0,
            snoozed_conversations: 0,
            unassigned_open: 0,
            messages_last_hour: 0,
            inbound_last_hour: 0,
            outbound_last_hour: 0,
            handoffs_last_hour: 0,
            meetings_last_hour: 0,
            agents_on_duty: 0,
            avg_first_reply_min: null,
          },
          hot_conversations: [],
          recent_handoffs: [],
          persona_pulse: [],
        };
      }
    },
    enabled: !!accountId,
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS,
    retry: false,
  });
  const loading = isLoading && !snap;

  // Realtime — pulsa o badge "ao vivo" e invalida cache quando aparecer handoff
  useEffect(() => {
    if (!accountId) return;
    return subscribeTable("agent_handoffs", (e) => {
      if (e.accountId !== accountId || e.op !== "INSERT") return;
      setPulse(true);
      void queryClient.invalidateQueries({ queryKey }).catch(() => void 0);
      setTimeout(() => setPulse(false), 1200);
    });
  }, [accountId, queryClient, queryKey]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operação"
        title="Mission Control"
        description="Cockpit vivo da operação omnichannel + Funcionários IA — atualizado a cada 10s e em tempo real para handoffs."
        actions={
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className={cn(
                "inline-flex h-2 w-2 rounded-full",
                pulse ? "bg-emerald-500 animate-ping" : "bg-emerald-500",
              )}
            />
            <span>{pulse ? "Evento ao vivo" : "Ao vivo"}</span>
          </div>
        }
      />

      <div className="space-y-6 px-6 pb-6">
      {loading && !snap && (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando cockpit…
        </div>
      )}

      {snap && snap.kpis && (
        <>
          {/* Linha 1 — Conversas */}
          <div className="grid gap-3 md:grid-cols-4">
            <Kpi
              icon={<Inbox className="h-4 w-4" />}
              label="Abertas"
              value={snap.kpis.open_conversations ?? 0}
              accent="primary"
            />
            <Kpi
              icon={<Clock className="h-4 w-4" />}
              label="Pendentes"
              value={snap.kpis.pending_conversations ?? 0}
            />
            <Kpi
              icon={<AlarmClock className="h-4 w-4" />}
              label="Snoozed"
              value={snap.kpis.snoozed_conversations ?? 0}
            />
            <Kpi
              icon={<UserRound className="h-4 w-4" />}
              label="Abertas sem dono"
              value={snap.kpis.unassigned_open ?? 0}
              accent={(snap.kpis.unassigned_open ?? 0) > 0 ? "warn" : undefined}
            />
          </div>

          {/* Linha 2 — Pulso da última hora */}
          <div className="grid gap-3 md:grid-cols-6">
            <Kpi
              icon={<MessageSquare className="h-4 w-4" />}
              label="Mensagens / 1h"
              value={snap.kpis.messages_last_hour ?? 0}
            />
            <Kpi
              icon={<ArrowDownLeft className="h-4 w-4" />}
              label="Entrada / 1h"
              value={snap.kpis.inbound_last_hour ?? 0}
            />
            <Kpi
              icon={<ArrowUpRight className="h-4 w-4" />}
              label="Saída / 1h"
              value={snap.kpis.outbound_last_hour ?? 0}
            />
            <Kpi
              icon={<ArrowRightLeft className="h-4 w-4" />}
              label="Handoffs / 1h"
              value={snap.kpis.handoffs_last_hour ?? 0}
            />
            <Kpi
              icon={<CalendarCheck className="h-4 w-4" />}
              label="Reuniões / 1h"
              value={snap.kpis.meetings_last_hour ?? 0}
            />
            <Kpi
              icon={<Activity className="h-4 w-4" />}
              label="Resp. inicial"
              value={
                snap.kpis.avg_first_reply_min != null ? `${snap.kpis.avg_first_reply_min} min` : "—"
              }
              accent={
                snap.kpis.avg_first_reply_min == null
                  ? undefined
                  : snap.kpis.avg_first_reply_min <= 5
                    ? "good"
                    : snap.kpis.avg_first_reply_min <= 15
                      ? "warn"
                      : "bad"
              }
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* Hot conversations */}
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Flame className="h-4 w-4 text-orange-500" /> Conversas quentes (2h)
                </CardTitle>
                <Badge variant="outline" className="text-[10px]">
                  <Users className="mr-1 h-3 w-3" /> {snap.kpis.agents_on_duty ?? 0} on-duty
                </Badge>
              </CardHeader>
              <CardContent className="p-0">
                {(snap.hot_conversations ?? []).length === 0 ? (
                  <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                    Nenhuma conversa com atividade nas últimas 2 horas.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-6 py-3">#</th>
                          <th className="px-3 py-3">Contato</th>
                          <th className="px-3 py-3">Canal</th>
                          <th className="px-3 py-3 text-right">Msgs/2h</th>
                          <th className="px-3 py-3">Status</th>
                          <th className="px-6 py-3 text-right">Dono</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(snap.hot_conversations ?? []).map((c) => (
                          <tr
                            key={c.conversation_id}
                            className="border-b last:border-b-0 hover:bg-muted/40"
                          >
                            <td className="px-6 py-3 font-mono text-xs text-muted-foreground">
                              #{c.display_id}
                            </td>
                            <td className="px-3 py-3 font-medium">{c.contact_name ?? "—"}</td>
                            <td className="px-3 py-3 text-muted-foreground">
                              {c.inbox_name ?? "—"}
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums font-semibold">
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1",
                                  c.message_count_2h >= 10 ? "text-orange-600" : "text-foreground",
                                )}
                              >
                                {c.message_count_2h >= 10 && <Zap className="h-3 w-3" />}
                                {c.message_count_2h}
                              </span>
                            </td>
                            <td className="px-3 py-3">
                              <StatusBadge status={c.status} priority={c.priority} />
                            </td>
                            <td className="px-6 py-3 text-right text-xs text-muted-foreground">
                              {c.assignee_id ? (
                                "Atribuída"
                              ) : (
                                <span className="text-amber-600">Sem dono</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent handoffs feed */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Radio className="h-4 w-4 text-primary" /> Handoffs recentes
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(snap.recent_handoffs ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum handoff registrado.</p>
                ) : (
                  (snap.recent_handoffs ?? []).map((h) => (
                    <div key={h.id} className="text-xs space-y-1 border-l-2 border-primary/40 pl-3">
                      <div className="flex items-center gap-1 font-medium text-foreground">
                        <span>{h.from_name ?? "—"}</span>
                        <ArrowRightLeft className="h-3 w-3 text-muted-foreground" />
                        <span className={h.to_kind === "human" ? "text-amber-600" : ""}>
                          {h.to_name ?? "—"}
                        </span>
                        {h.to_kind === "human" && (
                          <Badge variant="outline" className="ml-1 text-[9px] py-0">
                            humano
                          </Badge>
                        )}
                      </div>
                      <p className="text-muted-foreground line-clamp-2">{h.reason}</p>
                      <p className="text-[10px] text-muted-foreground/70">
                        {relTime(h.created_at)}
                      </p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          {/* Persona pulse */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bot className="h-4 w-4 text-primary" /> Pulso dos Funcionários IA (última hora)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {(snap.persona_pulse ?? []).length === 0 ? (
                <div className="px-6 py-8 text-center text-sm text-muted-foreground">
                  Nenhuma persona instalada. Use o{" "}
                  <Link to="/agents-playground" className="text-primary underline">
                    Playground IA
                  </Link>{" "}
                  para criar.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-6 py-3">Persona</th>
                        <th className="px-3 py-3">Função</th>
                        <th className="px-3 py-3 text-right">Mensagens / 1h</th>
                        <th className="px-3 py-3 text-right">Handoffs / 1h</th>
                        <th className="px-6 py-3 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(snap.persona_pulse ?? []).map((p) => (
                        <tr
                          key={p.persona_id}
                          className="border-b last:border-b-0 hover:bg-muted/40"
                        >
                          <td className="px-6 py-3 font-medium flex items-center gap-2">
                            <Bot className="h-4 w-4 text-primary" /> {p.name}
                          </td>
                          <td className="px-3 py-3 text-muted-foreground">{p.kind}</td>
                          <td className="px-3 py-3 text-right tabular-nums">
                            {p.messages_last_hour}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">
                            {p.handoffs_last_hour}
                          </td>
                          <td className="px-6 py-3 text-right">
                            <Badge
                              variant={p.status === "active" ? "default" : "secondary"}
                              className="text-[10px]"
                            >
                              {p.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <p className="text-[11px] text-muted-foreground">
            Snapshot gerado em {new Date(snap.generated_at).toLocaleTimeString("pt-BR")} •
            atualização automática a cada 10s
          </p>
        </>
      )}
      </div>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  accent?: "good" | "warn" | "bad" | "primary";
}) {
  return (
    <Card>
      <CardContent className="p-4 space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon} {label}
        </div>
        <div
          className={cn(
            "text-2xl font-semibold tabular-nums",
            accent === "good" && "text-emerald-600",
            accent === "warn" && "text-amber-600",
            accent === "bad" && "text-red-600",
            accent === "primary" && "text-primary",
          )}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status, priority }: { status: number; priority: number }) {
  const label =
    status === 0 ? "aberta" : status === 1 ? "resolvida" : status === 2 ? "pendente" : "snoozed";
  const variant: "default" | "secondary" | "outline" = status === 0 ? "default" : "secondary";
  return (
    <div className="flex items-center gap-1">
      <Badge variant={variant} className="text-[10px]">
        {label}
      </Badge>
      {priority >= 2 && (
        <Badge variant="outline" className="text-[10px] border-red-300 text-red-600">
          prio
        </Badge>
      )}
    </div>
  );
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  return new Date(iso).toLocaleString("pt-BR");
}

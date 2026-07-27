// Dashboard de Funcionários IA — KPIs por persona, janela configurável.

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BarChart3, Bot, Users, Smile, ArrowRightLeft, CalendarCheck, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/lib/account-context";
import { getAgentAnalytics, type AnalyticsResult } from "@/lib/agent-analytics.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/agents-analytics")({
  head: () => ({
    meta: [
      { title: "Analytics IA — Nexus" },
      {
        name: "description",
        content: "KPIs por Funcionário IA: handoffs, CSAT, reuniões geradas e cobertura.",
      },
    ],
  }),
  component: AnalyticsPage,
});

const WINDOWS = [
  { label: "7 dias", value: 7 },
  { label: "30 dias", value: 30 },
  { label: "90 dias", value: 90 },
];

function AnalyticsPage() {
  const { accountId } = useAccount();
  const [windowDays, setWindowDays] = useState(30);
  const [data, setData] = useState<AnalyticsResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    getAgentAnalytics({ accountId, windowDays })
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [accountId, windowDays]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Funcionários IA"
        title="Analytics IA"
        description="Como Bruno, Ana e Carla estão performando — mensagens, handoffs, CSAT, reuniões."
        actions={
          <div className="flex gap-1">
            {WINDOWS.map((w) => (
              <Button
                key={w.value}
                size="sm"
                variant={windowDays === w.value ? "default" : "outline"}
                onClick={() => setWindowDays(w.value)}
              >
                {w.label}
              </Button>
            ))}
          </div>
        }
      />

      <div className="space-y-6 px-6 pb-6">
      {loading && (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando KPIs...
        </div>
      )}

      {!loading && data && (
        <>
          {/* KPIs globais */}
          <div className="grid gap-4 md:grid-cols-4">
            <KpiCard
              icon={<Bot className="h-4 w-4" />}
              label="Personas ativas"
              value={data.total_personas}
            />
            <KpiCard
              icon={<ArrowRightLeft className="h-4 w-4" />}
              label="Handoffs no período"
              value={data.total_handoffs}
            />
            <KpiCard
              icon={<CalendarCheck className="h-4 w-4" />}
              label="Reuniões geradas"
              value={data.total_meetings}
            />
            <KpiCard
              icon={<Smile className="h-4 w-4" />}
              label="CSAT médio"
              value={
                typeof data.csat_avg_global === "number" ? data.csat_avg_global.toFixed(2) : "—"
              }
              accent={
                typeof data.csat_avg_global === "number"
                  ? data.csat_avg_global >= 4
                    ? "good"
                    : data.csat_avg_global >= 3
                      ? "warn"
                      : "bad"
                  : undefined
              }
            />
          </div>

          {/* Tabela por persona */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="h-4 w-4" /> Performance por persona
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {(data.per_persona ?? []).length === 0 ? (
                <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                  Nenhuma persona instalada ainda. Vá em <strong>Playground IA</strong> e converse
                  com Bruno, Ana ou Carla — elas são criadas no primeiro uso.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-6 py-3">Persona</th>
                        <th className="px-3 py-3">Função</th>
                        <th className="px-3 py-3 text-right">Handoffs</th>
                        <th className="px-3 py-3 text-right">Reuniões</th>
                        <th className="px-3 py-3 text-right">CSAT</th>
                        <th className="px-3 py-3 text-right">% baixas</th>
                        <th className="px-6 py-3 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data.per_persona ?? []).map((p) => (
                        <tr
                          key={p.persona_id}
                          className="border-b last:border-b-0 hover:bg-muted/40"
                        >
                          <td className="px-6 py-3 font-medium flex items-center gap-2">
                            <Bot className="h-4 w-4 text-primary" /> {p.name}
                          </td>
                          <td className="px-3 py-3 text-muted-foreground">{p.kind}</td>
                          <td className="px-3 py-3 text-right tabular-nums">{p.handoffs_out}</td>
                          <td className="px-3 py-3 text-right tabular-nums">
                            {p.meetings_scheduled || "—"}
                          </td>
                          <td
                            className={cn(
                              "px-3 py-3 text-right tabular-nums",
                              p.csat_avg === null
                                ? "text-muted-foreground"
                                : p.csat_avg >= 4
                                  ? "text-emerald-600"
                                  : p.csat_avg >= 3
                                    ? "text-amber-600"
                                    : "text-red-600",
                            )}
                          >
                            {p.csat_avg !== null ? `${p.csat_avg} (${p.csat_count})` : "—"}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                            {p.csat_low_pct}%
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

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Users className="h-3 w-3" />
            Janela: últimos {data.window_days} dias. KPIs atualizados em tempo real a cada mudança
            de período.
          </div>
        </>
      )}
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  accent?: "good" | "warn" | "bad";
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
          )}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

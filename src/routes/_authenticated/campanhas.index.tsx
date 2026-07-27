import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Rocket, PhoneCall, PhoneOff, ArrowRightLeft, Activity } from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "@/lib/account-context";
import {
  fetchCampaigns,
  aggregateCampaigns,
  CAMPAIGN_KIND_LABEL,
  CAMPAIGN_STATUS_LABEL,
  type CampaignRow,
  type CampaignKind,
} from "@/lib/campaigns";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/campanhas/")({
  head: () => ({
    meta: [
      { title: "Campanhas — Nina Talks" },
      { name: "description", content: "Campanhas operacionais de ligações com IA." },
    ],
  }),
  component: CampaignsPage,
});

function CampaignsPage() {
  const { accountId } = useAccount();
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!accountId) return;
    try {
      setRows(await fetchCampaigns(accountId));
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao carregar campanhas");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  const agg = useMemo(() => aggregateCampaigns(rows), [rows]);
  const connRate =
    agg.total_contacts > 0 ? Math.round((agg.connected / agg.total_contacts) * 100) : 0;
  const escRate =
    agg.connected > 0 ? Math.round((agg.escalated / agg.connected) * 100) : 0;
  const failRate =
    agg.placed > 0 ? Math.round((agg.failed / agg.placed) * 100) : 0;
  const ranking = useMemo(
    () =>
      Object.entries(agg.by_kind)
        .map(([kind, v]) => ({
          kind,
          ...v,
          connRate: v.total > 0 ? Math.round((v.connected / v.total) * 100) : 0,
        }))
        .sort((a, b) => b.connRate - a.connRate),
    [agg],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campanhas</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Operações de ligações com IA — SDR, Cobrança, Pós-venda e Retenção.
          </p>
        </div>
        <Link
          to="/campanhas/nova"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Nova campanha
        </Link>
      </header>

      {!loading && rows.length > 0 && (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <FunnelKpi icon={<Activity className="h-4 w-4" />} label="Em execução" value={`${agg.running}/${agg.total_campaigns}`} tone="primary" />
            <FunnelKpi icon={<PhoneCall className="h-4 w-4" />} label="Conexão" value={`${connRate}%`} sub={`${agg.connected} de ${agg.total_contacts}`} tone="emerald" />
            <FunnelKpi icon={<ArrowRightLeft className="h-4 w-4" />} label="Escalações" value={`${escRate}%`} sub={`${agg.escalated} handoffs`} tone="sky" />
            <FunnelKpi icon={<PhoneOff className="h-4 w-4" />} label="Falhas" value={`${failRate}%`} sub={`${agg.failed} de ${agg.placed} tentativas`} tone="rose" />
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Rocket className="h-4 w-4 text-primary" /> Ranking por tipo de operação
            </h2>
            {ranking.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sem dados ainda.</p>
            ) : (
              <div className="space-y-2">
                {ranking.map((r) => (
                  <div key={r.kind} className="flex items-center gap-3 text-sm">
                    <span
                      className={cn(
                        "w-28 shrink-0 rounded-md px-2 py-0.5 text-center text-[11px] font-medium ring-1 ring-inset",
                        kindClass(r.kind),
                      )}
                    >
                      {CAMPAIGN_KIND_LABEL[r.kind as CampaignKind] ?? r.kind}
                    </span>
                    <div className="flex-1">
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-primary" style={{ width: `${r.connRate}%` }} />
                      </div>
                    </div>
                    <span className="w-32 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {r.connected}/{r.total} · {r.connRate}% · {r.campaigns} camp.
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <div className="rounded-xl border border-border bg-card">
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Rocket className="h-6 w-6" />
            Nenhuma campanha ainda. Crie a primeira em “Nova campanha”.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Nome</th>
                <th className="px-4 py-2 font-medium">Tipo</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Funil</th>
                <th className="px-4 py-2 font-medium">Criada em</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const conn =
                  r.total_contacts > 0
                    ? Math.round((r.connected_count / r.total_contacts) * 100)
                    : 0;
                return (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2">
                      <Link
                        to="/campanhas/$campaignId"
                        params={{ campaignId: r.id }}
                        className="font-medium text-foreground hover:text-primary"
                      >
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={cn(
                          "rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                          kindClass(r.campaign_kind),
                        )}
                      >
                        {r.campaign_kind
                          ? CAMPAIGN_KIND_LABEL[r.campaign_kind as CampaignKind] ??
                            r.campaign_kind
                          : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={cn(
                          "rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                          statusClass(r.status),
                        )}
                      >
                        {CAMPAIGN_STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs">
                      <div className="flex items-center gap-3">
                        <span className="tabular-nums text-foreground">
                          {r.connected_count}/{r.total_contacts}
                        </span>
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-primary"
                            style={{ width: `${conn}%` }}
                          />
                        </div>
                        <span className="text-muted-foreground tabular-nums">{conn}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleString("pt-BR")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function FunnelKpi({
  icon,
  label,
  value,
  sub,
  tone = "primary",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "primary" | "emerald" | "sky" | "rose";
}) {
  const toneCls = {
    primary: "text-primary",
    emerald: "text-emerald-600",
    sky: "text-sky-600",
    rose: "text-rose-600",
  }[tone];
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", toneCls)}>
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function kindClass(kind: string | null): string {
  switch (kind) {
    case "sdr":
      return "bg-primary/10 text-primary ring-primary/20";
    case "cobranca":
      return "bg-amber-500/15 text-amber-400 ring-amber-500/30";
    case "retencao":
      return "bg-rose-500/15 text-rose-400 ring-rose-500/30";
    case "pos_venda":
      return "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30";
    default:
      return "bg-muted text-muted-foreground ring-border";
  }
}

function statusClass(status: string): string {
  switch (status) {
    case "running":
      return "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30";
    case "scheduled":
      return "bg-sky-500/15 text-sky-400 ring-sky-500/30";
    case "paused":
      return "bg-amber-500/15 text-amber-400 ring-amber-500/30";
    case "completed":
      return "bg-muted text-muted-foreground ring-border";
    case "canceled":
      return "bg-rose-500/15 text-rose-400 ring-rose-500/30";
    default:
      return "bg-muted text-muted-foreground ring-border";
  }
}

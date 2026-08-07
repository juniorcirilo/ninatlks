import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Plus,
  Rocket,
  PhoneCall,
  PhoneOff,
  ArrowRightLeft,
  Activity,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "@/lib/account-context";
import { useRealtimeRefresh } from "@/lib/realtime-client";
import {
  fetchCampaigns,
  aggregateCampaigns,
  updateCampaign,
  deleteCampaign,
  MIN_INTERVAL_OPTIONS,
  MAX_ATTEMPTS_OPTIONS,
  CAMPAIGN_KIND_LABEL,
  CAMPAIGN_STATUS_LABEL,
  type CampaignRow,
  type CampaignKind,
} from "@/lib/campaigns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** datetime-local exige hora local sem zona. */
function localDateTimeValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

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
  const [editing, setEditing] = useState<CampaignRow | null>(null);
  const [deleting, setDeleting] = useState<CampaignRow | null>(null);

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
  }, [refresh]);

  // Substitui o polling de 15s: contadores de funil mudam a cada ligação
  // discada, e voice_campaign_contacts emite em toda transição de status.
  useRealtimeRefresh(["voice_campaigns", "voice_campaign_contacts"], accountId, refresh);

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
                <th className="px-4 py-2 text-right font-medium">Ações</th>
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
                      {r.scheduled_at && (
                        <div className="text-[11px] text-primary">
                          dispara {new Date(r.scheduled_at).toLocaleString("pt-BR", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setEditing(r)}
                          title="Editar nome e agendamento"
                          aria-label={`Editar ${r.name}`}
                          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => r.status !== "running" && setDeleting(r)}
                          disabled={r.status === "running"}
                          title={
                            r.status === "running"
                              ? "Pause a campanha antes de excluir"
                              : "Excluir campanha"
                          }
                          aria-label={`Excluir ${r.name}`}
                          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <EditCampaignDialog
        campaign={editing}
        accountId={accountId ?? ""}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          refresh();
        }}
      />

      <DeleteCampaignDialog
        campaign={deleting}
        accountId={accountId ?? ""}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null);
          refresh();
        }}
      />
    </div>
  );
}

function EditCampaignDialog({
  campaign,
  accountId,
  onClose,
  onSaved,
}: {
  campaign: CampaignRow | null;
  accountId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [minInterval, setMinInterval] = useState<number>(5);
  const [maxPerDay, setMaxPerDay] = useState<number>(1000);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!campaign) return;
    setName(campaign.name);
    setScheduledAt(
      campaign.scheduled_at ? localDateTimeValue(new Date(campaign.scheduled_at)) : "",
    );
    setMinInterval(campaign.min_minutes_between_attempts ?? 5);
    setMaxPerDay(campaign.max_attempts_per_day ?? 1000);
  }, [campaign?.id]);

  const save = async () => {
    if (!campaign || saving) return;
    if (!name.trim()) return toast.error("Informe um nome");

    const had = Boolean(campaign.scheduled_at);
    let nextScheduled: string | null | undefined;
    if (scheduledAt) {
      const when = new Date(scheduledAt);
      if (Number.isNaN(when.getTime())) return toast.error("Data de disparo inválida");
      if (when.getTime() <= Date.now())
        return toast.error("A data de disparo precisa estar no futuro");
      nextScheduled = when.toISOString();
    } else if (had) {
      // limpou o campo de uma campanha agendada = desagendar
      nextScheduled = null;
    }

    setSaving(true);
    try {
      const r = await updateCampaign(accountId, campaign.id, {
        name: name.trim(),
        minMinutesBetweenAttempts: minInterval,
        maxAttemptsPerDay: maxPerDay,
        ...(nextScheduled !== undefined ? { scheduledAt: nextScheduled } : {}),
      });
      toast.success(
        r.scheduledAt
          ? `Campanha salva — dispara ${new Date(r.scheduledAt).toLocaleString("pt-BR", {
              dateStyle: "short",
              timeStyle: "short",
            })}`
          : "Campanha salva — sem agendamento, inicie manualmente",
      );
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao salvar campanha");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(campaign)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar campanha</DialogTitle>
          <DialogDescription>
            Nome e agendamento. Lista, agente, número e parâmetros de discagem ficam na
            página da campanha.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Nome</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Máximo de tentativas por dia
            </label>
            <Select value={String(maxPerDay)} onValueChange={(v) => setMaxPerDay(Number(v))}>
              <SelectTrigger className="w-full bg-background text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MAX_ATTEMPTS_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n === 1000 ? "1000 (sem limite prático)" : n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Intervalo mínimo entre tentativas
            </label>
            <Select value={String(minInterval)} onValueChange={(v) => setMinInterval(Number(v))}>
              <SelectTrigger className="w-full bg-background text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MIN_INTERVAL_OPTIONS.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {m} {m === 1 ? "minuto" : "minutos"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Tempo mínimo antes de rediscar o mesmo número nesta campanha.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Disparar em
            </label>
            <input
              type="datetime-local"
              value={scheduledAt}
              min={localDateTimeValue(new Date(Date.now() + 60_000))}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {campaign && campaign.status !== "draft" && campaign.status !== "scheduled"
                ? `Campanha ${CAMPAIGN_STATUS_LABEL[campaign.status] ?? campaign.status} — mudar a data não a reagenda.`
                : scheduledAt
                  ? "Começa sozinha nesse horário."
                  : "Em branco: rascunho, iniciado manualmente."}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteCampaignDialog({
  campaign,
  accountId,
  onClose,
  onDeleted,
}: {
  campaign: CampaignRow | null;
  accountId: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deletingNow, setDeletingNow] = useState(false);
  const isRunning = campaign?.status === "running";

  const confirm = async () => {
    if (!campaign || deletingNow || isRunning) return;
    setDeletingNow(true);
    try {
      const r = await deleteCampaign(accountId, campaign.id);
      toast.success(
        `Campanha "${campaign.name}" excluída — ${r.deletedContacts} contato(s) saíram da fila`,
      );
      onDeleted();
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao excluir campanha");
    } finally {
      setDeletingNow(false);
    }
  };

  return (
    <AlertDialog open={Boolean(campaign)} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir “{campaign?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            {isRunning
              ? "Esta campanha está em execução. Pause ou cancele antes de excluir — apagar no meio da discagem deixaria ligações em andamento sem campanha de destino."
              : "A fila de contatos desta campanha é removida junto e não dá pra desfazer. As ligações já feitas continuam no histórico em Ligações."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deletingNow}>
            {isRunning ? "Entendi" : "Cancelar"}
          </AlertDialogCancel>
          {!isRunning && (
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirm();
              }}
              disabled={deletingNow}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingNow && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Excluir
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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

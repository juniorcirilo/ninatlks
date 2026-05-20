import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Play, Pause, Square, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  CAMPAIGN_KIND_LABEL,
  CAMPAIGN_STATUS_LABEL,
  type CampaignKind,
} from "@/lib/campaigns";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/campanhas/$campaignId")({
  head: () => ({ meta: [{ title: "Campanha — Nina Talks" }] }),
  component: CampaignDetailPage,
});

type Campaign = {
  id: string;
  name: string;
  status: string;
  campaign_kind: string | null;
  total_contacts: number;
  placed_count: number;
  connected_count: number;
  escalated_count: number;
  voicemail_count: number;
  failed_count: number;
  opening_script: string | null;
  from_number: string;
  created_at: string;
};

type ContactRow = {
  id: number;
  to_number: string;
  status: string;
  attempts: number;
  last_attempt_at: string | null;
  last_error: string | null;
  voice_call_id: string | null;
};

const STATUS_BUCKET: Record<string, string> = {
  queued: "Em fila",
  placed: "Discadas",
  connected: "Atendidas",
  completed: "Concluídas",
  escalated: "Escaladas",
  voicemail: "Caixa postal",
  failed: "Falharam",
  no_answer: "Sem resposta",
  cancelled: "Canceladas",
};

const STATUS_ORDER = [
  "queued",
  "placed",
  "connected",
  "completed",
  "escalated",
  "voicemail",
  "no_answer",
  "failed",
  "cancelled",
];

function CampaignDetailPage() {
  const { campaignId } = Route.useParams();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [c, cc] = await Promise.all([
        (supabase as any)
          .from("voice_campaigns")
          .select(
            "id,name,status,campaign_kind,total_contacts,placed_count,connected_count,escalated_count,voicemail_count,failed_count,opening_script,from_number,created_at",
          )
          .eq("id", campaignId)
          .maybeSingle(),
        (supabase as any)
          .from("voice_campaign_contacts")
          .select("id,to_number,status,attempts,last_attempt_at,last_error,voice_call_id")
          .eq("campaign_id", campaignId)
          .order("id", { ascending: false })
          .limit(500),
      ]);
      if (c.error) throw c.error;
      setCampaign(c.data as Campaign);
      setContacts((cc.data ?? []) as ContactRow[]);
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao carregar campanha");
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel(`campaign-${campaignId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "voice_campaign_contacts",
          filter: `campaign_id=eq.${campaignId}`,
        },
        () => refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "voice_campaigns",
          filter: `id=eq.${campaignId}`,
        },
        () => refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [campaignId, refresh]);

  const setStatus = async (next: string) => {
    const patch: any = { status: next };
    if (next === "running" && !campaign?.id) return;
    if (next === "running") patch.started_at = new Date().toISOString();
    if (next === "completed" || next === "canceled") patch.finished_at = new Date().toISOString();

    const { error } = await (supabase as any)
      .from("voice_campaigns")
      .update(patch)
      .eq("id", campaignId);
    if (error) return toast.error(error.message);
    toast.success("Status atualizado");
    refresh();
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Campanha não encontrada.</div>
    );
  }

  const buckets = STATUS_ORDER.reduce<Record<string, number>>((acc, s) => {
    acc[s] = contacts.filter((c) => c.status === s).length;
    return acc;
  }, {});

  const conn =
    campaign.total_contacts > 0
      ? Math.round((campaign.connected_count / campaign.total_contacts) * 100)
      : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link to="/campanhas" className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Campanhas
        </Link>
      </div>

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{campaign.name}</h1>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {campaign.campaign_kind
                ? CAMPAIGN_KIND_LABEL[campaign.campaign_kind as CampaignKind] ?? campaign.campaign_kind
                : "—"}
            </span>
            <span>·</span>
            <span>De {campaign.from_number}</span>
            <span>·</span>
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                statusClass(campaign.status),
              )}
            >
              {CAMPAIGN_STATUS_LABEL[campaign.status] ?? campaign.status}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          {(campaign.status === "draft" || campaign.status === "paused" || campaign.status === "scheduled") && (
            <button
              onClick={() => setStatus("running")}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Play className="h-4 w-4" /> Iniciar
            </button>
          )}
          {campaign.status === "running" && (
            <button
              onClick={() => setStatus("paused")}
              className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted"
            >
              <Pause className="h-4 w-4" /> Pausar
            </button>
          )}
          {(campaign.status === "running" || campaign.status === "paused") && (
            <button
              onClick={() => setStatus("canceled")}
              className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10"
            >
              <Square className="h-4 w-4" /> Encerrar
            </button>
          )}
        </div>
      </header>

      {/* Funnel cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Metric label="Total" value={campaign.total_contacts} />
        <Metric label="Discadas" value={campaign.placed_count} />
        <Metric label="Atendidas" value={campaign.connected_count} accent />
        <Metric label="Escaladas" value={campaign.escalated_count} />
        <Metric label="Falhas" value={campaign.failed_count} tone="bad" />
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Funil de execução</h2>
          <span className="text-xs text-muted-foreground">
            Taxa de atendimento: <span className="font-semibold text-foreground">{conn}%</span>
          </span>
        </div>
        <div className="space-y-2">
          {STATUS_ORDER.map((s) => {
            const count = buckets[s] ?? 0;
            const pct = campaign.total_contacts > 0 ? (count / campaign.total_contacts) * 100 : 0;
            return (
              <div key={s} className="flex items-center gap-3 text-xs">
                <span className="w-28 text-muted-foreground">{STATUS_BUCKET[s] ?? s}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full", bucketBar(s))}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-12 text-right tabular-nums">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold">
          Contatos ({contacts.length})
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 border-b border-border bg-card text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Número</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Tentativas</th>
                <th className="px-4 py-2 font-medium">Última tentativa</th>
                <th className="px-4 py-2 font-medium">Erro</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 font-mono text-xs">{c.to_number}</td>
                  <td className="px-4 py-2">
                    <span
                      className={cn(
                        "rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                        contactStatusClass(c.status),
                      )}
                    >
                      {STATUS_BUCKET[c.status] ?? c.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 tabular-nums">{c.attempts}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {c.last_attempt_at
                      ? new Date(c.last_attempt_at).toLocaleString("pt-BR")
                      : "—"}
                  </td>
                  <td className="px-4 py-2 text-xs text-destructive/80">
                    {c.last_error ?? ""}
                  </td>
                </tr>
              ))}
              {contacts.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-xs text-muted-foreground">
                    Nenhum contato.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
  tone,
}: {
  label: string;
  value: number;
  accent?: boolean;
  tone?: "bad";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-3",
        accent ? "border-primary/30 bg-primary/[0.03]" : "border-border",
      )}
    >
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          accent && "text-primary",
          tone === "bad" && "text-destructive",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function bucketBar(status: string): string {
  switch (status) {
    case "connected":
    case "completed":
      return "bg-primary";
    case "escalated":
      return "bg-amber-500";
    case "voicemail":
      return "bg-sky-400";
    case "failed":
    case "no_answer":
    case "cancelled":
      return "bg-rose-400";
    default:
      return "bg-muted-foreground/40";
  }
}

function statusClass(status: string): string {
  switch (status) {
    case "running":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    case "scheduled":
      return "bg-sky-50 text-sky-700 ring-sky-200";
    case "paused":
      return "bg-amber-50 text-amber-700 ring-amber-200";
    case "completed":
      return "bg-muted text-muted-foreground ring-border";
    case "canceled":
      return "bg-rose-50 text-rose-700 ring-rose-200";
    default:
      return "bg-muted text-muted-foreground ring-border";
  }
}

function contactStatusClass(status: string): string {
  switch (status) {
    case "connected":
    case "completed":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    case "escalated":
      return "bg-amber-50 text-amber-700 ring-amber-200";
    case "voicemail":
      return "bg-sky-50 text-sky-700 ring-sky-200";
    case "failed":
    case "no_answer":
    case "cancelled":
      return "bg-rose-50 text-rose-700 ring-rose-200";
    case "placed":
      return "bg-primary/10 text-primary ring-primary/20";
    default:
      return "bg-muted text-muted-foreground ring-border";
  }
}

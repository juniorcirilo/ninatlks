import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  Play,
  Pause,
  Square,
  ArrowLeft,
  Check,
  X,
  Eye,
  Inbox,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "@/lib/account-context";
import { subscribeTable } from "@/lib/realtime-client";
import {
  fetchCampaign,
  fetchCampaignContacts,
  fetchEnrollmentBatches,
  fetchBatchPreview,
  decideEnrollmentBatch,
  updateCampaignStatus,
  retryFailedCampaignContacts,
  CAMPAIGN_KIND_LABEL,
  CAMPAIGN_STATUS_LABEL,
  type CampaignDetail,
  type CampaignContactRow,
  type CampaignKind,
  type EnrollmentBatch,
  type BatchPreviewRow,
} from "@/lib/campaigns";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/campanhas/$campaignId")({
  head: () => ({ meta: [{ title: "Campanha — Nina Talks" }] }),
  component: CampaignDetailPage,
});

type Campaign = CampaignDetail;
type ContactRow = CampaignContactRow;

/**
 * O que aconteceu com cada contato, em linguagem de operação.
 *
 * `status` e `outcome` são duas metades da mesma história e separá-los em
 * colunas obrigava a lê-las juntas pra entender o caso. Pior: no funil, "não
 * atendeu", "recusou" e "falha da operadora" caíam todos em "Falharam" —
 * escondendo exatamente a distinção que importa pra decidir se vale rediscar.
 * Aqui os dois viram um estágio só.
 */
type Stage =
  | "na_fila"
  | "chamando"
  | "em_ligacao"
  | "atendeu"
  | "nao_atendeu"
  | "recusou"
  | "caixa_postal"
  | "nao_completou"
  | "falhou"
  | "escalada"
  | "cancelada";

const STAGE_LABEL: Record<Stage, string> = {
  na_fila: "Na fila",
  chamando: "Chamando",
  em_ligacao: "Em ligação",
  atendeu: "Atendeu",
  nao_atendeu: "Não atendeu",
  recusou: "Recusou",
  caixa_postal: "Caixa postal",
  nao_completou: "Não completou",
  falhou: "Falha da operadora",
  escalada: "Transferida",
  cancelada: "Cancelada",
};

/** Ordem de leitura do funil: da espera até os desfechos. */
const STAGE_ORDER: Stage[] = [
  "na_fila",
  "chamando",
  "em_ligacao",
  "atendeu",
  "escalada",
  "caixa_postal",
  "nao_atendeu",
  "recusou",
  "nao_completou",
  "falhou",
  "cancelada",
];

const OUTCOME_TO_STAGE: Record<string, Stage> = {
  atendida: "atendeu",
  caixa_postal: "caixa_postal",
  nao_atendeu: "nao_atendeu",
  recusada: "recusou",
  falha_operadora: "falhou",
  nao_completou: "nao_completou",
  cancelada: "cancelada",
};

function stageOf(c: { status: string; outcome: string | null }): Stage {
  // Enquanto a ligação está viva, o status manda: é o dado que muda em tempo
  // real. Terminou, o outcome é mais específico e passa a mandar.
  switch (c.status) {
    case "queued":
      return "na_fila";
    case "placed":
    case "ringing":
      return "chamando";
    case "connected":
      return "em_ligacao";
    case "escalated":
      return "escalada";
  }
  if (c.outcome && OUTCOME_TO_STAGE[c.outcome]) return OUTCOME_TO_STAGE[c.outcome];
  // Terminal sem outcome: ligações anteriores ao registro de desfecho.
  if (c.status === "voicemail") return "caixa_postal";
  if (c.status === "canceled") return "cancelada";
  if (c.status === "completed") return "atendeu";
  return "falhou";
}

function stageClass(stage: Stage): string {
  switch (stage) {
    case "atendeu":
    case "escalada":
      return "bg-emerald-500/10 text-emerald-600 ring-emerald-500/20";
    case "em_ligacao":
      return "bg-sky-500/10 text-sky-600 ring-sky-500/20";
    case "chamando":
      return "bg-blue-500/10 text-blue-600 ring-blue-500/20";
    case "recusou":
      return "bg-orange-500/10 text-orange-600 ring-orange-500/20";
    case "nao_atendeu":
    case "caixa_postal":
      return "bg-amber-500/10 text-amber-600 ring-amber-500/20";
    case "falhou":
    case "nao_completou":
      return "bg-rose-500/10 text-rose-600 ring-rose-500/20";
    default:
      return "bg-muted text-muted-foreground ring-border";
  }
}

function stageBar(stage: Stage): string {
  switch (stage) {
    case "atendeu":
    case "escalada":
      return "bg-emerald-500";
    case "em_ligacao":
      return "bg-sky-500";
    case "chamando":
      return "bg-blue-500";
    case "recusou":
      return "bg-orange-500";
    case "nao_atendeu":
    case "caixa_postal":
      return "bg-amber-500";
    case "falhou":
    case "nao_completou":
      return "bg-rose-500";
    default:
      return "bg-muted-foreground/40";
  }
}

function CampaignDetailPage() {
  const { campaignId } = Route.useParams();
  const { accountId } = useAccount();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [batches, setBatches] = useState<EnrollmentBatch[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!accountId) return;
    try {
      const [c, cc, bb] = await Promise.all([
        fetchCampaign(accountId, campaignId),
        fetchCampaignContacts(accountId, campaignId),
        fetchEnrollmentBatches(accountId, campaignId),
      ]);
      setCampaign(c);
      setContacts(cc);
      setBatches(bb);
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao carregar campanha");
    } finally {
      setLoading(false);
    }
  }, [accountId, campaignId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Realtime: qualquer mudança em voice_campaigns/voice_campaign_contacts
  // desta conta reconsulta os dados desta campanha (payload não carrega
  // campaign_id — o refetch é barato e a página só olha uma campanha).
  useEffect(() => {
    if (!accountId) return;
    const unsub1 = subscribeTable("voice_campaigns", (e) => {
      if (e.accountId === accountId) refresh();
    });
    const unsub2 = subscribeTable("voice_campaign_contacts", (e) => {
      if (e.accountId === accountId) refresh();
    });
    return () => {
      unsub1();
      unsub2();
    };
  }, [accountId, refresh]);

  const setStatus = async (next: string) => {
    if (!accountId) return;
    try {
      await updateCampaignStatus(accountId, campaignId, next);
      toast.success("Status atualizado");
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao atualizar status");
    }
  };

  const failedContacts = contacts.filter(
    (c) => c.status === "failed" || (c.status === "queued" && !!c.last_error),
  ).length;

  const canRetry = (c: ContactRow) =>
    campaign?.status !== "canceled" &&
    (c.status === "failed" || (c.status === "queued" && !!c.last_error));

  const retryFailed = async (contactRowId?: string) => {
    if (!accountId) return;
    try {
      const { requeued } = await retryFailedCampaignContacts(
        accountId,
        campaignId,
        contactRowId,
      );
      toast.success(
        requeued > 0
          ? `${requeued} contato${requeued > 1 ? "s" : ""} de volta na fila`
          : "Nenhum contato com falha",
      );
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao reenfileirar contatos");
    }
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!campaign) {
    return <div className="p-6 text-sm text-muted-foreground">Campanha não encontrada.</div>;
  }

  const buckets = STAGE_ORDER.reduce<Record<string, number>>((acc, s) => {
    acc[s] = contacts.filter((c) => stageOf(c) === s).length;
    return acc;
  }, {});

  const conn =
    campaign.total_contacts > 0
      ? Math.round((campaign.connected_count / campaign.total_contacts) * 100)
      : 0;

  return (
    <div className="w-full space-y-6 p-6">
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
                ? (CAMPAIGN_KIND_LABEL[campaign.campaign_kind as CampaignKind] ??
                  campaign.campaign_kind)
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
          {(campaign.status === "draft" ||
            campaign.status === "paused" ||
            campaign.status === "scheduled") && (
            <button
              onClick={() => setStatus("running")}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Play className="h-4 w-4" /> Iniciar
            </button>
          )}
          {failedContacts > 0 && campaign.status !== "canceled" && (
            <button
              onClick={() => retryFailed()}
              className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted"
            >
              <RotateCcw className="h-4 w-4" /> Tentar novamente ({failedContacts})
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

      <EnrollmentQueue
        accountId={accountId}
        campaignId={campaignId}
        batches={batches}
        onDecided={refresh}
      />

      {/* Funnel cards — ao vivo + histórico */}
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Metric label="Na fila agora" value={campaign.queued_count ?? 0} live />
          <Metric label="Chamando agora" value={campaign.ringing_count ?? 0} live />
          <Metric label="Em ligação agora" value={campaign.in_progress_count ?? 0} live accent />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Metric label="Total" value={campaign.total_contacts} />
          <Metric label="Discadas" value={campaign.placed_count} />
          <Metric label="Atendidas" value={campaign.connected_count} accent />
          <Metric label="Escaladas" value={campaign.escalated_count} />
          <Metric label="Falhas" value={campaign.failed_count} tone="bad" />
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Funil de execução</h2>
          <span className="text-xs text-muted-foreground">
            Taxa de atendimento: <span className="font-semibold text-foreground">{conn}%</span>
          </span>
        </div>
        <div className="space-y-2">
          {STAGE_ORDER.map((s) => {
            const count = buckets[s] ?? 0;
            const pct = campaign.total_contacts > 0 ? (count / campaign.total_contacts) * 100 : 0;
            // Estágios vazios só poluem: mostra os que têm contato, mais os
            // três da linha do tempo ativa, que dão a sensação de progresso.
            const alwaysShow = s === "na_fila" || s === "chamando" || s === "atendeu";
            if (count === 0 && !alwaysShow) return null;
            return (
              <div key={s} className="flex items-center gap-3 text-xs">
                <span className="w-32 text-muted-foreground">{STAGE_LABEL[s]}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className={cn("h-full", stageBar(s))} style={{ width: `${pct}%` }} />
                </div>
                <span className="w-12 text-right tabular-nums">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40">
        <div className="border-b border-gray-200 dark:border-slate-800 px-4 py-3 text-sm font-semibold">
          Contatos ({contacts.length})
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 border-b border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Número</th>
                <th className="px-4 py-2 font-medium">O que aconteceu</th>
                <th className="px-4 py-2 font-medium">Duração</th>
                <th className="px-4 py-2 font-medium">Tentativas</th>
                <th className="px-4 py-2 font-medium">Última tentativa</th>
                <th className="px-4 py-2 font-medium">Erro</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-b border-gray-200 dark:border-slate-800 last:border-0">
                  <td className="px-4 py-2 font-mono text-xs">{c.to_number}</td>
                  <td className="px-4 py-2">
                    {(() => {
                      const stage = stageOf(c);
                      const live = stage === "chamando" || stage === "em_ligacao";
                      // Contato adiado por compliance continua "Na fila", mas
                      // com motivo e horário de retorno — senão parece travado.
                      const heldUntil =
                        stage === "na_fila" &&
                        c.dispatch_after &&
                        new Date(c.dispatch_after) > new Date()
                          ? new Date(c.dispatch_after)
                          : null;
                      return (
                        <div className="space-y-0.5">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                              stageClass(stage),
                            )}
                          >
                            {live && (
                              <span className="relative flex h-1.5 w-1.5">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
                                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
                              </span>
                            )}
                            {STAGE_LABEL[stage]}
                          </span>
                          {heldUntil && (
                            <div className="text-[10px] leading-tight text-muted-foreground">
                              {c.last_error ?? "Aguardando liberação"} · volta{" "}
                              {heldUntil.toLocaleTimeString("pt-BR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-2 text-xs tabular-nums text-muted-foreground">
                    {c.call_duration_sec
                      ? `${Math.floor(c.call_duration_sec / 60)}:${String(
                          c.call_duration_sec % 60,
                        ).padStart(2, "0")}`
                      : "—"}
                  </td>
                  <td className="px-4 py-2 tabular-nums">{c.attempts}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {c.last_attempt_at ? new Date(c.last_attempt_at).toLocaleString("pt-BR") : "—"}
                  </td>
                  {/* Só falha de verdade. Em contato adiado o last_error
                      carrega o motivo do compliance, que já aparece junto do
                      estágio — repetir aqui em vermelho sugeriria erro. */}
                  <td className="px-4 py-2 text-xs text-destructive/80">
                    {c.status === "queued" ? "" : (c.last_error ?? "")}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {canRetry(c) && (
                      <button
                        onClick={() => retryFailed(c.id)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1 text-xs hover:bg-muted"
                      >
                        <RotateCcw className="h-3 w-3" /> Tentar novamente
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {contacts.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-xs text-muted-foreground">
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

/**
 * Fila de aprovação de lotes da campanha viva.
 *
 * A trava só vale se quem aprova puder ver o que está aprovando: um botão
 * "aprovar 1.284 contatos" sem a amostra é carimbo, não decisão. Por isso o
 * preview abre com nome, telefone e as variáveis com que a agente vai ligar.
 */
function EnrollmentQueue({
  accountId,
  campaignId,
  batches,
  onDecided,
}: {
  accountId: string | null;
  campaignId: string;
  batches: EnrollmentBatch[];
  onDecided: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [preview, setPreview] = useState<BatchPreviewRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const pending = batches.filter((b) => b.status === "pending");
  const decided = batches.filter((b) => b.status !== "pending").slice(0, 5);

  const togglePreview = async (batchId: string) => {
    if (openId === batchId) {
      setOpenId(null);
      return;
    }
    if (!accountId) return;
    setOpenId(batchId);
    setPreview([]);
    try {
      setPreview(await fetchBatchPreview(accountId, campaignId, batchId));
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao carregar amostra");
    }
  };

  const decide = async (batchId: string, decision: "approve" | "reject") => {
    if (!accountId) return;
    setBusy(batchId);
    try {
      const res = await decideEnrollmentBatch(accountId, campaignId, batchId, decision);
      if (!res.ok) {
        toast.error(
          res.reason === "already_decided"
            ? "Este lote já foi decidido por outra pessoa."
            : (res.reason ?? "falha ao decidir o lote"),
        );
      } else if (decision === "approve") {
        toast.success(`${res.queued ?? 0} contato(s) liberado(s) para discagem`);
      } else {
        toast.success(`${res.removed ?? 0} contato(s) descartado(s) deste lote`);
      }
      setOpenId(null);
      onDecided();
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao decidir o lote");
    } finally {
      setBusy(null);
    }
  };

  if (pending.length === 0 && decided.length === 0) return null;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Inbox className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Lotes da integração</h2>
        {pending.length > 0 && (
          <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-500/30 dark:text-amber-300">
            {pending.length} aguardando aprovação
          </span>
        )}
      </div>

      {pending.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhum lote pendente. A próxima carga do sistema de origem aparece aqui.
        </p>
      ) : (
        <div className="space-y-2">
          {pending.map((b) => (
            <div key={b.id} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <span className="font-medium tabular-nums">{b.still_pending}</span> contato(s)
                  novo(s)
                  <span className="text-muted-foreground">
                    {" "}
                    · {new Date(b.created_at).toLocaleString("pt-BR")}
                    {b.source ? ` · ${b.source}` : ""}
                  </span>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => togglePreview(b.id)}
                    className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-xs hover:bg-muted"
                  >
                    <Eye className="h-3 w-3" /> {openId === b.id ? "Fechar" : "Ver amostra"}
                  </button>
                  <button
                    disabled={busy === b.id}
                    onClick={() => decide(b.id, "reject")}
                    className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  >
                    <X className="h-3 w-3" /> Descartar
                  </button>
                  <button
                    disabled={busy === b.id}
                    onClick={() => decide(b.id, "approve")}
                    className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {busy === b.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Check className="h-3 w-3" />
                    )}
                    Aprovar e discar
                  </button>
                </div>
              </div>

              {openId === b.id && (
                <div className="mt-3 overflow-x-auto rounded-md border border-gray-200 dark:border-slate-800 bg-background">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 text-left text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">Nome</th>
                        <th className="px-2 py-1.5 font-medium">Código</th>
                        <th className="px-2 py-1.5 font-medium">Telefone</th>
                        <th className="px-2 py-1.5 font-medium">Dados da operação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-2 py-3 text-center text-muted-foreground">
                            Carregando amostra…
                          </td>
                        </tr>
                      ) : (
                        preview.map((r, i) => (
                          <tr key={i} className="border-t border-gray-200 dark:border-slate-800">
                            <td className="px-2 py-1.5">{r.name ?? "—"}</td>
                            <td className="px-2 py-1.5 font-mono text-[11px]">
                              {r.external_id ?? "—"}
                            </td>
                            <td className="px-2 py-1.5 tabular-nums">{r.phone_number}</td>
                            <td className="px-2 py-1.5">
                              {Object.entries(r.variables ?? {}).length === 0
                                ? "—"
                                : Object.entries(r.variables)
                                    .map(([k, v]) => `${k}: ${String(v)}`)
                                    .join(" · ")}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                  {preview.length > 0 && b.still_pending > preview.length && (
                    <div className="border-t border-gray-200 dark:border-slate-800 px-2 py-1.5 text-[11px] text-muted-foreground">
                      Amostra dos {preview.length} primeiros de {b.still_pending}.
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {decided.length > 0 && (
        <div className="mt-3 border-t border-gray-200 dark:border-slate-800 pt-2">
          <div className="mb-1 text-[11px] font-medium text-muted-foreground">
            Decididos recentemente
          </div>
          <ul className="space-y-0.5 text-[11px] text-muted-foreground">
            {decided.map((b) => (
              <li key={b.id}>
                {b.status === "approved" ? "Aprovado" : "Descartado"} · {b.contact_count} contato(s)
                {b.decided_by_name ? ` por ${b.decided_by_name}` : ""}
                {b.decided_at ? ` em ${new Date(b.decided_at).toLocaleString("pt-BR")}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
  tone,
  live,
}: {
  label: string;
  value: number;
  accent?: boolean;
  tone?: "bad";
  live?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-white dark:bg-slate-900/40 p-3",
        live && !accent ? "border-sky-500/20 bg-sky-500/[0.03]" : "",
        accent && live ? "border-sky-500/40 bg-sky-500/[0.05]" : "",
        accent && !live ? "border-primary/30 bg-primary/[0.03]" : "",
        !accent && !live ? "border-gray-200 dark:border-slate-800" : "",
      )}
    >
      <div className={cn("flex items-center gap-1.5 text-[11px] uppercase tracking-wider", live ? "text-sky-600" : "text-muted-foreground")}>
        {live && <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />}
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          live && !accent && "text-sky-600",
          live && accent && "text-sky-500",
          !live && accent && "text-primary",
          tone === "bad" && "text-destructive",
        )}
      >
        {value}
      </div>
    </div>
  );
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


// "Integrações" tab on /settings. Pings each external API with the
// configured keys and shows status + usage. Replaces the old 2141-line
// OnboardingWizard — nobody wants a multi-step wizard, just a single
// dashboard that's always visible.

import { useCallback, useEffect, useState } from "react";
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleDashed,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  MessageCircle,
  Phone,
  RefreshCw,
  Sparkles,
  Video,
  Volume2,
  Workflow,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/lib/account-context";
import { cn } from "@/lib/utils";
import { fetchIntegrationsStatus, type NexusReport, type ProviderReport } from "@/lib/integrations-status-cache";
import {
  ProviderCredentialsDialog,
  type CredentialProviderKey,
} from "@/components/settings/ProviderCredentialsDialog";
import { EvolutionQuickConnect } from "@/components/onboarding/EvolutionQuickConnect";
import { syncAgentSourcesToN8n, describeN8nSync } from "@/lib/n8n";
import { AgentLlmProviderCard } from "@/components/settings/AgentLlmProviderCard";

type Status = "ok" | "fail" | "missing" | "unknown";

const PROVIDER_META: Record<
  ProviderReport["key"],
  {
    icon: React.ComponentType<{ className?: string }>;
    setupHint: string;
    setupHref: string;
    /** key used by ProviderCredentialsDialog. null means this provider is configured elsewhere (e.g. channels). */
    credentialKey: CredentialProviderKey | null;
  }
> = {
  deepgram: {
    icon: Sparkles,
    setupHint: "API key da Deepgram, usada para transcrever chamadas. Salva no vault deste workspace.",
    setupHref: "/settings",
    credentialKey: "deepgram",
  },
  elevenlabs: {
    icon: Volume2,
    setupHint: "Pegue a API Key em elevenlabs.io/app/settings/api-keys. As keys ficam no vault deste workspace, não no código.",
    setupHref: "/agents",
    credentialKey: "elevenlabs",
  },
  twilio: {
    icon: Phone,
    setupHint: "Account SID + Auth Token em console.twilio.com. As credenciais são salvas criptografadas no vault deste workspace.",
    setupHref: "/phone-numbers",
    credentialKey: "twilio",
  },
  n8n: {
    icon: Workflow,
    setupHint:
      "URL da instância + API Key (gerada em Settings → n8n API). Ao conectar, criamos o workflow \"Utalks\" e um nó por agente com fonte de dados — ver Webhooks → Recebimento.",
    setupHref: "/settings",
    credentialKey: "n8n",
  },
  evolution: {
    icon: MessageCircle,
    setupHint: "URL + API key do seu servidor Evolution self-hosted. Conecte WhatsApp pelo assistente de onboarding ou aqui em Integrações.",
    setupHref: "/settings",
    credentialKey: null,
  },
  google_calendar: {
    icon: Video,
    setupHint: "Conecte sua conta Google em Reuniões para gerar automaticamente o link do Meet em cada reunião criada por um admin.",
    setupHref: "/reunioes",
    credentialKey: null,
  },
  resend: {
    icon: Mail,
    setupHint: "API key da Resend, usada para enviar o e-mail de confirmação de reunião (convidado + host).",
    setupHref: "/settings",
    credentialKey: "resend",
  },
};

function statusOf(p: ProviderReport): Status {
  if (!p.configured) return "missing";
  if (p.ok === true) return "ok";
  if (p.ok === false) return "fail";
  return "unknown";
}

export function IntegrationsTab() {
  const { accountId } = useAccount();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderReport[]>([]);
  const [nexus, setNexus] = useState<NexusReport | null>(null);
  const [credDialogFor, setCredDialogFor] = useState<CredentialProviderKey | null>(null);
  const [evolutionOpen, setEvolutionOpen] = useState(false);
  const [syncingN8n, setSyncingN8n] = useState(false);

  /**
   * Botão "Sincronizar" do card n8n: garante o nó de cada agente no workflow
   * Utalks e já cria fonte de dados para quem não tinha nenhuma. Mesma
   * chamada que roda sozinha ao salvar as credenciais — este botão é para
   * rodar de novo depois, ex.: quando um agente novo é cadastrado.
   */
  const handleSyncN8n = async () => {
    if (!accountId) return;
    setSyncingN8n(true);
    try {
      const sync = await syncAgentSourcesToN8n(accountId);
      for (const m of describeN8nSync(sync)) toast[m.level](m.message);
    } catch (e: any) {
      toast.error(`Falha ao sincronizar com o n8n: ${e?.body?.message ?? e?.message ?? "erro"}`);
    } finally {
      setSyncingN8n(false);
    }
  };

  const load = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!accountId) {
        setLoading(false);
        setLoadError("Conta não identificada.");
        return;
      }
      if (opts.silent) setRefreshing(true);
      else setLoading(true);
      try {
        const d = await fetchIntegrationsStatus(accountId, {
          ttlMs: 2 * 60_000,
          force: opts.silent,
        });
        const list = d.providers ?? [];
        setProviders(list);
        setNexus(d.nexus ?? null);
        setLoadError(null);
        // `silent` marca o clique manual em "Revalidar" — o carregamento
        // automático da aba não deve disparar toast. Sem isso o botão só
        // rodava o spinner e não dizia nada quando o resultado não mudava.
        if (opts.silent) {
          const failing = list.filter((p) => statusOf(p) === "fail");
          const missing = list.filter((p) => statusOf(p) === "missing");
          const okCount = list.filter((p) => statusOf(p) === "ok").length;
          if (failing.length > 0) {
            toast.error(
              `${failing.map((p) => p.label).join(", ")} com falha: ${
                failing[0].detail ?? "verifique as credenciais"
              }`,
            );
          } else if (missing.length > 0) {
            toast.warning(
              `${okCount} de ${list.length} integrações OK — falta configurar ${missing
                .map((p) => p.label)
                .join(", ")}`,
            );
          } else {
            toast.success(`Todas as ${list.length} integrações responderam OK`);
          }
        }
      } catch (e) {
        console.error("[integrations-status] failed", e);
        const msg =
          e instanceof Error && e.message === "timeout"
            ? "A checagem de integrações demorou demais para responder."
            : "Não foi possível carregar o status das integrações.";
        setLoadError(msg);
        if (opts.silent) toast.error(msg);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [accountId],
  );

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError && providers.length === 0 && !nexus) {
    return (
      <div className="rounded-xl border border-border bg-muted/20 p-5">
        <div className="flex items-start gap-3">
          <CircleAlert className="mt-0.5 h-5 w-5 text-amber-500" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">Integrações indisponíveis agora</h3>
            <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => load({ silent: true })} disabled={refreshing}>
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          </Button>
        </div>
      </div>
    );
  }

  const readinessOk =
    providers.filter((p) => statusOf(p) === "ok").length > 0 &&
    (nexus?.agents_synced_to_el ?? 0) > 0 &&
    (nexus?.numbers_ai_active ?? 0) > 0;

  return (
    <div className="space-y-6">
      {/* Readiness banner */}
      <div
        className={cn(
          "rounded-xl border p-5",
          readinessOk
            ? "border-emerald-500/40 bg-emerald-500/15"
            : "border-amber-500/40 bg-amber-500/15",
        )}
      >
        <div className="flex items-start gap-3">
          {readinessOk ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
          ) : (
            <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          )}
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">
              {readinessOk
                ? "Plataforma pronta pra operar"
                : "Faltam alguns passos pra ligar tudo"}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {readinessOk
                ? "Teus canais, agentes e números estão configurados. Podes ligar pro cliente."
                : "Configure as integrações abaixo e crie ao menos 1 agente sincronizado + 1 número com IA ativa."}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => load({ silent: true })} disabled={refreshing}>
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Provider cards */}
      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Integrações externas
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {providers.map((p) => (
            <ProviderCard
              key={p.key}
              report={p}
              onConfigure={(k) => setCredDialogFor(k)}
              onEvolutionConnect={() => setEvolutionOpen(true)}
              onSyncN8n={handleSyncN8n}
              syncingN8n={syncingN8n}
            />
          ))}
        </div>
      </div>

      {/* Provedor de IA — vale tanto pros agentes de voz (ElevenLabs, quando
          Modelo = "IA própria") quanto pros Funcionários IA de texto (Bruno,
          Ana, Carla...), a menos que um agente defina sua própria URL/modelo
          na aba Modelo dele. */}
      {accountId && (
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Provedor de IA padrão da conta
          </h3>
          <AgentLlmProviderCard accountId={accountId} />
        </div>
      )}

      {/* Nina Talks readiness */}
      {nexus && (
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Seu setup dentro do Nina Talks
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard
              icon={Bot}
              label="Agentes IA"
              value={`${nexus.agents_synced_to_el}/${nexus.agents_total}`}
              detail={
                nexus.agents_synced_to_el === 0
                  ? "Crie um agente em /agents e clique 'Sincronizar com EL'"
                  : `${nexus.agents_synced_to_el} sincronizado${nexus.agents_synced_to_el > 1 ? "s" : ""} com ElevenLabs`
              }
              href="/agents"
              ok={nexus.agents_synced_to_el > 0}
            />
            <StatCard
              icon={Phone}
              label="Números com IA ativa"
              value={`${nexus.numbers_ai_active}/${nexus.numbers_total}`}
              detail={
                nexus.numbers_ai_active === 0
                  ? "Em /phone-numbers, clique 'Ativar IA' depois de pinar uma persona"
                  : `${nexus.numbers_ai_active} número${nexus.numbers_ai_active > 1 ? "s" : ""} respondendo via IA`
              }
              href="/phone-numbers"
              ok={nexus.numbers_ai_active > 0}
            />
            <StatCard
              icon={Sparkles}
              label="Canais de mensagem"
              value={`${providers.filter((p) => p.key === "evolution").reduce((acc, p) => acc + (typeof p.usage?.instancias_conectadas === "number" ? p.usage.instancias_conectadas : 0), 0)}`}
              detail="Instâncias WhatsApp conectadas via Evolution"
              href="/settings"
              ok={true}
            />
          </div>
        </div>
      )}

      {accountId && (
        <ProviderCredentialsDialog
          open={credDialogFor !== null}
          onOpenChange={(v) => { if (!v) setCredDialogFor(null); }}
          provider={credDialogFor}
          accountId={accountId}
          onSaved={() => load({ silent: true })}
        />
      )}
      {accountId && (
        <EvolutionQuickConnect
          open={evolutionOpen}
          onOpenChange={setEvolutionOpen}
          accountId={accountId}
          onConnected={() => load({ silent: true })}
        />
      )}
    </div>
  );
}

function ProviderCard({
  report,
  onConfigure,
  onEvolutionConnect,
  onSyncN8n,
  syncingN8n,
}: {
  report: ProviderReport;
  onConfigure: (k: CredentialProviderKey) => void;
  onEvolutionConnect: () => void;
  onSyncN8n: () => void;
  syncingN8n: boolean;
}) {
  const meta = PROVIDER_META[report.key];
  const Icon = meta.icon;
  const status = statusOf(report);
  const isN8n = report.key === "n8n";
  const isEvolution = report.key === "evolution";
  const isGoogleCalendar = report.key === "google_calendar";

  return (
    <div className="glass flex flex-col gap-3 rounded-lg p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              status === "ok" && "bg-emerald-500/15 text-emerald-400",
              status === "fail" && "bg-rose-500/15 text-rose-400",
              status === "missing" && "bg-muted text-muted-foreground",
              status === "unknown" && "bg-amber-500/15 text-amber-400",
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h4 className="truncate text-sm font-semibold">{report.label}</h4>
            <p className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">
              {status === "ok" && "Operando"}
              {status === "fail" && "Com problema"}
              {status === "missing" && "Não configurado"}
              {status === "unknown" && "Desconhecido"}
            </p>
          </div>
        </div>
        {status === "ok" && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />}
        {status === "fail" && <CircleAlert className="h-4 w-4 shrink-0 text-rose-400" />}
        {status === "missing" && <CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </div>

      {report.detail && (
        <p className="text-[11px] text-muted-foreground">{report.detail}</p>
      )}

      {status === "missing" && (
        <p className="rounded-md bg-muted/40 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
          {meta.setupHint}
        </p>
      )}

      {report.usage && Object.keys(report.usage).length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-border pt-2">
          {Object.entries(report.usage).map(([k, v]) => (
            <span
              key={k}
              className="inline-flex items-center gap-1 rounded bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              <span className="text-[9px] uppercase tracking-wider opacity-70">
                {k.replace(/_/g, " ")}
              </span>
              <span className="font-mono font-semibold text-foreground">{String(v)}</span>
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        {meta.credentialKey ? (
          <div className="flex items-center gap-1.5">
            {report.locked ? (
              <span
                title="N8N_URL/N8N_API_KEY definidas no ambiente do servidor — não é possível alterar por aqui."
                className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground"
              >
                <Lock className="h-3 w-3" />
                Fixado pelo servidor
              </span>
            ) : (
              <Button
                type="button"
                size="sm"
                variant={status === "missing" || status === "fail" ? "default" : "outline"}
                onClick={() => onConfigure(meta.credentialKey!)}
                className="h-7 text-[11px]"
              >
                <KeyRound className="h-3 w-3" />
                {status === "missing" ? "Conectar" : "Atualizar credenciais"}
              </Button>
            )}
            {isN8n && status === "ok" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onSyncN8n}
                disabled={syncingN8n}
                title='Garante o nó de cada agente no workflow "Utalks" e cria fonte de dados para quem ainda não tem'
                className="h-7 text-[11px]"
              >
                <RefreshCw className={cn("h-3 w-3", syncingN8n && "animate-spin")} />
                {syncingN8n ? "Sincronizando…" : "Sincronizar"}
              </Button>
            )}
          </div>
        ) : isEvolution ? (
          <Button
            type="button"
            size="sm"
            variant={status === "ok" ? "outline" : "default"}
            onClick={onEvolutionConnect}
            className="h-7 text-[11px]"
          >
            <MessageCircle className="h-3 w-3" />
            {status === "ok" ? "Gerenciar canais" : "Conectar WhatsApp"}
          </Button>
        ) : isGoogleCalendar ? (
          <Button type="button" size="sm" variant={status === "ok" ? "outline" : "default"} asChild className="h-7 text-[11px]">
            <Link to="/reunioes">
              <Video className="h-3 w-3" />
              {status === "ok" ? "Gerenciar em Reuniões" : "Conectar em Reuniões"}
            </Link>
          </Button>
        ) : (
          <span className="text-[10px] text-muted-foreground">Configurado por canal</span>
        )}
        {isEvolution ? (
          <button
            type="button"
            onClick={onEvolutionConnect}
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:text-primary"
          >
            Abrir <ChevronRight className="h-3 w-3" />
          </button>
        ) : (
          <Link
            to={meta.setupHref}
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:text-primary"
          >
            Abrir <ChevronRight className="h-3 w-3" />
          </Link>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
  href,
  ok,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
  href: string;
  ok: boolean;
}) {
  return (
    <Link
      to={href}
      className={cn(
        "glass flex flex-col gap-2 rounded-lg p-4 transition-colors hover:bg-muted",
        ok ? "border-emerald-500/40" : "border-amber-500/40",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {ok ? (
          <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-emerald-400" />
        ) : (
          <CircleAlert className="ml-auto h-3.5 w-3.5 text-amber-400" />
        )}
      </div>
      <div className="font-mono text-lg font-bold tabular-nums">{value}</div>
      <p className="text-[11px] text-muted-foreground">{detail}</p>
    </Link>
  );
}

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
  MessageCircle,
  Phone,
  RefreshCw,
  Sparkles,
  Volume2,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/lib/account-context";
import { cn } from "@/lib/utils";
import { fetchIntegrationsStatus, type NexusReport, type ProviderReport } from "@/lib/integrations-status-cache";
import {
  ProviderCredentialsDialog,
  type CredentialProviderKey,
} from "@/components/settings/ProviderCredentialsDialog";

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
  evolution: {
    icon: MessageCircle,
    setupHint: "URL + API key do seu servidor Evolution self-hosted. Conecte WhatsApp pelo assistente de onboarding ou aqui em Integrações.",
    setupHref: "/settings",
    credentialKey: null,
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
        setProviders(d.providers ?? []);
        setNexus(d.nexus ?? null);
        setLoadError(null);
      } catch (e) {
        console.error("[integrations-status] failed", e);
        setLoadError(
          e instanceof Error && e.message === "timeout"
            ? "A checagem de integrações demorou demais para responder."
            : "Não foi possível carregar o status das integrações.",
        );
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
            ? "border-emerald-300 bg-emerald-100"
            : "border-amber-300 bg-amber-50",
        )}
      >
        <div className="flex items-start gap-3">
          {readinessOk ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
          ) : (
            <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-800" />
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
            />
          ))}
        </div>
      </div>

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
    </div>
  );
}

function ProviderCard({
  report,
  onConfigure,
}: {
  report: ProviderReport;
  onConfigure: (k: CredentialProviderKey) => void;
}) {
  const meta = PROVIDER_META[report.key];
  const Icon = meta.icon;
  const status = statusOf(report);

  return (
    <div className="glass flex flex-col gap-3 rounded-lg p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              status === "ok" && "bg-emerald-100 text-emerald-700",
              status === "fail" && "bg-rose-50 text-rose-700",
              status === "missing" && "bg-muted text-muted-foreground",
              status === "unknown" && "bg-amber-50 text-amber-800",
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
        {status === "ok" && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />}
        {status === "fail" && <CircleAlert className="h-4 w-4 shrink-0 text-rose-700" />}
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
        ) : (
          <span className="text-[10px] text-muted-foreground">Configurado por canal</span>
        )}
        <Link
          to={meta.setupHref}
          className="inline-flex items-center gap-1 text-[11px] text-primary hover:text-primary"
        >
          Abrir <ChevronRight className="h-3 w-3" />
        </Link>
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
        ok ? "border-emerald-300" : "border-amber-300",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {ok ? (
          <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-emerald-700" />
        ) : (
          <CircleAlert className="ml-auto h-3.5 w-3.5 text-amber-800" />
        )}
      </div>
      <div className="font-mono text-lg font-bold tabular-nums">{value}</div>
      <p className="text-[11px] text-muted-foreground">{detail}</p>
    </Link>
  );
}

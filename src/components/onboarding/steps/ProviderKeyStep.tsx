// Tela genérica para pedir as keys de UM provedor durante o onboarding.
// Cada step (ElevenLabs, Twilio, Deepgram) instancia este componente com seus
// próprios campos. As keys vão direto pro Vault da conta via setAccountSecretsBulk.
// Botão "Testar conexão" chama runHealthCheck(force=true) e atualiza o badge.

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  listAccountSecrets,
  setAccountSecretsBulk,
  type SecretProvider,
} from "@/lib/account-secrets";
import { runHealthCheck } from "@/lib/onboarding";
import type { IntegrationsStatusReport, ProviderReport } from "@/lib/integrations-status-cache";

export interface ProviderField {
  /** Nome da chave em account_secrets (ex.: "api_key", "auth_token"). */
  name: string;
  label: string;
  placeholder?: string;
  /** Default true (renderiza como password). */
  secret?: boolean;
  required?: boolean;
  helpText?: string;
}

export interface ProviderKeyStepProps {
  accountId: string;
  /** Provider key como em account_secrets E em integrations-status. */
  provider: SecretProvider & ("elevenlabs" | "twilio" | "deepgram");
  title: string;
  whatItDoes: string;
  fields: ProviderField[];
  dashboardUrl?: string;
  /** Passos numerados de "onde pegar a key". */
  instructions: string[];
  /** Status atual cacheado (vem do health_check_results da onboarding row). */
  initialReport?: IntegrationsStatusReport | null;
  /** Chamado quando o status fica "ok" depois de salvar+testar. */
  onConnected?: () => void;
}

export function ProviderKeyStep({
  accountId,
  provider,
  title,
  whatItDoes,
  fields,
  dashboardUrl,
  instructions,
  initialReport,
  onConnected,
}: ProviderKeyStepProps) {
  // Estado local dos inputs.
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, ""])),
  );
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [report, setReport] = useState<IntegrationsStatusReport | null>(initialReport ?? null);
  // O relatório que vem cacheado de `health_check_results` pode estar velho
  // (ex.: 401 antes da key ser salva). Só passamos a confiar nele depois que o
  // próprio passo rodar um teste fresh nesta sessão.
  const [freshReport, setFreshReport] = useState(false);

  // Carrega quais keys já estão salvas (sem revelar valores).
  useEffect(() => {
    let cancelled = false;
    setLoadingSaved(true);
    listAccountSecrets(accountId)
      .then((list) => {
        if (cancelled) return;
        const mine = list
          .filter((e) => e.provider === provider)
          .map((e) => e.key_name);
        setSavedKeys(new Set(mine));
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoadingSaved(false));
    return () => { cancelled = true; };
  }, [accountId, provider]);

  // Status derivado do report — só mostra "ok"/"error" se o relatório for fresh.
  // Antes do primeiro teste manual, evitamos exibir o erro antigo (que pode ser
  // de antes da key ser salva).
  const status = useMemo<"ok" | "warn" | "error" | "unknown">(() => {
    if (!freshReport) return "unknown";
    const p = report?.providers.find((x) => x.key === provider) as ProviderReport | undefined;
    if (!p) return "unknown";
    if (!p.configured) return "warn";
    if (p.ok === false) return "error";
    if (p.ok === true) return "ok";
    return "unknown";
  }, [report, provider, freshReport]);

  const detail = useMemo(() => {
    if (!freshReport) return null;
    const p = report?.providers.find((x) => x.key === provider) as ProviderReport | undefined;
    if (!p) return null;
    if (!p.configured) return "Key não configurada";
    if (p.ok === false) return p.detail ?? "Key inválida";
    return p.detail ?? "Conectado";
  }, [report, provider, freshReport]);

  // Pode salvar se TODOS os required estão preenchidos OU já estavam salvos.
  const canSave = useMemo(() => {
    return fields.every((f) => {
      if (!f.required) return true;
      const v = values[f.name]?.trim();
      if (v) return true;
      return savedKeys.has(f.name); // já tem uma versão salva
    });
  }, [values, fields, savedKeys]);

  const hasNewInput = useMemo(
    () => Object.values(values).some((v) => v.trim().length > 0),
    [values],
  );

  async function handleSaveAndTest() {
    if (!canSave) return;
    setSaving(true);
    try {
      // Só envia ao Vault os campos que o usuário digitou de fato.
      const toSave: Record<string, string> = {};
      for (const f of fields) {
        const v = values[f.name]?.trim();
        if (v) toSave[f.name] = v;
      }
      if (Object.keys(toSave).length > 0) {
        await setAccountSecretsBulk(accountId, provider, toSave);
        // Atualiza set local de salvas.
        const next = new Set(savedKeys);
        Object.keys(toSave).forEach((k) => next.add(k));
        setSavedKeys(next);
        // Limpa inputs (já estão no Vault).
        setValues(Object.fromEntries(fields.map((f) => [f.name, ""])));
        toast.success("Keys salvas com segurança");
      }

      // Testa conexão imediatamente.
      setTesting(true);
      const r = await runHealthCheck(accountId, { force: true });
      setReport(r);
      setFreshReport(true);
      const p = r.providers.find((x) => x.key === provider);
      if (p?.ok) {
        toast.success(`${title} conectado!`);
        onConnected?.();
      } else if (p && !p.configured) {
        toast.warning("Faltam keys para conectar");
      } else if (p?.ok === false) {
        toast.error(`Falha: ${p.detail ?? "key inválida"}`);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar/testar");
    } finally {
      setSaving(false);
      setTesting(false);
    }
  }

  async function handleTestOnly() {
    setTesting(true);
    try {
      const r = await runHealthCheck(accountId, { force: true });
      setReport(r);
      setFreshReport(true);
      const p = r.providers.find((x) => x.key === provider);
      if (p?.ok) {
        toast.success(`${title} conectado!`);
        onConnected?.();
      } else if (p?.ok === false) {
        toast.error(`Falha: ${p.detail ?? "key inválida"}`);
      } else {
        toast.warning("Ainda não configurado");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao testar");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <StatusBadge status={status} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{whatItDoes}</p>
        {detail && status !== "unknown" && (
          <div
            className={
              status === "ok"
                ? "mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-medium text-emerald-800"
                : status === "error"
                ? "mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-medium text-rose-800"
                : "mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-800"
            }
          >
            {detail}
          </div>
        )}
      </div>

      {/* Inputs */}
      <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-4">
        {loadingSaved ? (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…
          </div>
        ) : (
          fields.map((f) => {
            const isSaved = savedKeys.has(f.name);
            return (
              <div key={f.name} className="space-y-1.5">
                <Label
                  htmlFor={`pk-${provider}-${f.name}`}
                  className="flex items-center gap-2 text-xs font-medium text-foreground"
                >
                  {f.label}
                  {f.required && <span className="text-destructive">*</span>}
                  {isSaved && (
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-700">
                      <ShieldCheck className="h-2.5 w-2.5" /> salva
                    </span>
                  )}
                </Label>
                <Input
                  id={`pk-${provider}-${f.name}`}
                  type={f.secret === false ? "text" : "password"}
                  placeholder={isSaved ? "•••••••• (deixe em branco pra manter)" : f.placeholder}
                  value={values[f.name]}
                  onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                  autoComplete="off"
                  className="font-mono text-xs bg-background"
                />
                {f.helpText && (
                  <p className="text-[11px] text-muted-foreground">{f.helpText}</p>
                )}
              </div>
            );
          })
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            onClick={handleSaveAndTest}
            disabled={saving || testing || (!hasNewInput && !savedKeys.size) || !canSave}
          >
            {(saving || testing) && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {hasNewInput ? "Salvar e testar" : "Testar conexão"}
          </Button>
          {hasNewInput && savedKeys.size > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleTestOnly}
              disabled={testing || saving}
            >
              Apenas testar
            </Button>
          )}
        </div>
      </div>

      {/* Instruções colapsáveis */}
      <details className="rounded-lg border border-border bg-background p-3 text-sm">
        <summary className="cursor-pointer text-[12px] font-semibold text-foreground hover:text-primary">
          Onde pegar essas keys?
        </summary>
        <ol className="mt-3 space-y-1.5">
          {instructions.map((step, i) => (
            <li key={i} className="flex gap-2 text-[12px] text-muted-foreground">
              <span className="shrink-0 font-semibold text-primary tabular-nums">{i + 1}.</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        {dashboardUrl && (
          <a
            href={dashboardUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
          >
            Abrir painel do provedor <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </details>
    </div>
  );
}

function StatusBadge({ status }: { status: "ok" | "warn" | "error" | "unknown" }) {
  if (status === "ok") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
        <CheckCircle2 className="h-3 w-3" /> Conectado
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-700">
        <XCircle className="h-3 w-3" /> Erro
      </span>
    );
  }
  if (status === "warn") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
        <AlertTriangle className="h-3 w-3" /> Pendente
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      Não testado
    </span>
  );
}

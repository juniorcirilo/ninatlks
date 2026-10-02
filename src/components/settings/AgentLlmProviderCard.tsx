// "Provedor de IA do Agente" — Configurações → Integrações. Escolhe o LLM
// usado pelos Funcionários IA de texto (Bruno, Ana, Carla, Felipe, Clara,
// Diego, Supervisor, Playground). Salva em account_secrets (provider
// 'agent-llm', vault) via os endpoints genéricos de secrets; "Carregar
// modelos" e "Testar Conexão" passam pelo backend (agent-llm-provider) porque
// a maioria dessas APIs bloqueia CORS de chamada direta do navegador.
import { useEffect, useState } from "react";
import { Cpu, Eye, EyeOff, KeyRound, Loader2, PlayCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiClient } from "@/lib/api-client";
import { setAccountSecretsBulk, listAccountSecrets } from "@/lib/account-secrets";
import { PROVIDERS, type ProviderId } from "@/lib/agents/providers";

export function AgentLlmProviderCard({ accountId }: { accountId: string }) {
  const [provider, setProvider] = useState<ProviderId | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [temperature, setTemperature] = useState(0.7);
  const [configured, setConfigured] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listAccountSecrets(accountId)
      .then((rows) =>
        setConfigured(rows.some((r) => r.provider === "agent-llm" && r.key_name === "provider")),
      )
      .catch(() => {
        /* card não é crítico pro resto da tela */
      });
  }, [accountId]);

  const meta = provider ? PROVIDERS.find((p) => p.id === provider) : null;

  function selectProvider(id: ProviderId) {
    setProvider(id);
    const next = PROVIDERS.find((p) => p.id === id);
    setBaseUrl(next?.defaultBaseUrl ?? "");
    setModel("");
    setModels([]);
  }

  async function handleLoadModels() {
    if (!provider) return;
    setLoadingModels(true);
    try {
      const { models: list } = await apiClient.post<{ models: string[] }>(
        `/accounts/${accountId}/agent-llm-provider/models`,
        { provider, apiKey: apiKey || undefined, baseUrl: baseUrl || undefined },
      );
      setModels(list);
      if (list.length === 0) toast.warning("Nenhum modelo retornado por este provedor.");
      else if (!model) setModel(list[0]);
    } catch (e: any) {
      toast.error(e?.body?.message ?? e?.message ?? "Falha ao carregar modelos");
    } finally {
      setLoadingModels(false);
    }
  }

  async function handleTestConnection() {
    if (!provider) return;
    if (!model.trim()) {
      toast.warning("Selecione ou digite um modelo antes de testar.");
      return;
    }
    setTesting(true);
    try {
      const res = await apiClient.post<{ ok: true; message: string }>(
        `/accounts/${accountId}/agent-llm-provider/test`,
        { provider, apiKey: apiKey || undefined, baseUrl: baseUrl || undefined, modelId: model },
      );
      toast.success(res.message);
    } catch (e: any) {
      toast.error(e?.body?.message ?? e?.message ?? "Falha ao testar conexão");
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (!provider) {
      toast.warning("Escolha um provedor primeiro.");
      return;
    }
    if (meta?.requiresApiKey && !apiKey.trim() && !configured) {
      toast.warning(`${meta.label} exige uma API Key.`);
      return;
    }
    setSaving(true);
    try {
      await setAccountSecretsBulk(accountId, "agent-llm", {
        provider,
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
        base_url: baseUrl.trim(),
        model_id: model.trim(),
        temperature: String(temperature),
      });
      setConfigured(true);
      toast.success("Provedor de IA do Agente salvo.");
    } catch (e: any) {
      toast.error(e?.body?.message ?? e?.message ?? "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Cpu className="h-4.5 w-4.5 text-muted-foreground" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold">Provedor de IA do Agente</h4>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                  configured ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-foreground",
                )}
              >
                {configured ? "Configurado" : "Não configurado"}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Padrão da conta pros agentes de voz (ElevenLabs, quando Modelo = "IA própria") e
              pros Funcionários IA de texto (Bruno, Ana, Carla, Felipe, Clara, Diego,
              Supervisor) — a menos que um agente defina sua própria URL/modelo na aba Modelo
              dele.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <Label className="mb-2 block text-xs">Provedor</Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => selectProvider(p.id)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left transition hover:bg-muted",
                  provider === p.id ? "border-primary bg-primary/5" : "border-gray-200 dark:border-slate-800",
                )}
              >
                <div className="text-sm font-medium">{p.label}</div>
                <div className="text-[10px] text-muted-foreground">{p.hint}</div>
              </button>
            ))}
          </div>
          {provider === "anthropic" && (
            <p className="mt-2 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-400">
              A ElevenLabs (agentes de voz) só integra com endpoints no formato OpenAI —
              Anthropic funciona pros Funcionários IA de texto, mas ligações de voz com Modelo
              = "IA própria" vão falhar ao sincronizar se este for o provedor da conta.
            </p>
          )}
        </div>

        {provider && (
          <>
            <div>
              <Label htmlFor="agent-llm-key" className="mb-2 flex items-center gap-1 text-xs">
                <KeyRound className="h-3 w-3" /> API Key
                {!meta?.requiresApiKey && <span className="text-muted-foreground">(opcional)</span>}
              </Label>
              <div className="relative">
                <Input
                  id="agent-llm-key"
                  type={showApiKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={configured ? "•••••••••••••••••••• (deixe em branco pra manter)" : "sk-..."}
                  className="pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <Label htmlFor="agent-llm-model" className="text-xs">Modelo</Label>
                  <button
                    type="button"
                    onClick={handleLoadModels}
                    disabled={loadingModels}
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline disabled:opacity-50"
                  >
                    <RefreshCw className={cn("h-3 w-3", loadingModels && "animate-spin")} />
                    Carregar modelos
                  </button>
                </div>
                {models.length > 0 ? (
                  <Select value={model} onValueChange={setModel}>
                    <SelectTrigger id="agent-llm-model">
                      <SelectValue placeholder="Selecione um modelo" />
                    </SelectTrigger>
                    <SelectContent>
                      {models.map((m) => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="agent-llm-model"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="ex.: gpt-4o-mini"
                  />
                )}
              </div>

              <div>
                <Label htmlFor="agent-llm-base-url" className="mb-2 block text-xs">
                  Base URL {meta?.defaultBaseUrl ? "(opcional)" : ""}
                </Label>
                <Input
                  id="agent-llm-base-url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={meta?.defaultBaseUrl ?? "https://..."}
                />
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label className="text-xs">Temperatura (criatividade das respostas)</Label>
                <span className="font-mono text-xs text-muted-foreground">{temperature.toFixed(2)}</span>
              </div>
              <Slider
                value={[temperature]}
                onValueChange={([v]) => setTemperature(v)}
                min={0}
                max={2}
                step={0.05}
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Valores baixos (0–0.5) deixam a IA mais previsível e aderente às instruções de
                formato; valores altos (1.5–2) deixam as respostas mais variadas, mas menos
                confiáveis para seguir instruções exatas.
              </p>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" onClick={handleTestConnection} disabled={testing}>
                {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
                Testar Conexão
              </Button>
              <Button type="button" size="sm" onClick={handleSave} disabled={saving} className="ml-auto">
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Salvar
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

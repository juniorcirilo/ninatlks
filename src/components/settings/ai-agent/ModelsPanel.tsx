import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, PlayCircle, Plus, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  listAiModels,
  saveAiConnection,
  testAiConnection,
  updateAiAgentSettings,
  type AiAgentOverview,
  type ReplyLanguage,
} from "@/lib/ai-agent";
import { EFFORTS, LANGUAGES, MAX_FALLBACKS, errMsg } from "./shared";

export function BehaviorCard({
  accountId,
  connection,
  settings,
  onSaved,
}: {
  accountId: string;
  connection: AiAgentOverview["connection"];
  settings: AiAgentOverview["settings"];
  onSaved: () => void;
}) {
  const [baseUrl, setBaseUrl] = useState(connection.base_url);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(connection.model_id);
  const [fallbacks, setFallbacks] = useState<string[]>(settings.fallback_models);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testing, setTesting] = useState(false);

  const probeBody = () => ({
    baseUrl: baseUrl.trim() || undefined,
    apiKey: apiKey.trim() || undefined,
  });

  const loadModels = async () => {
    if (!baseUrl.trim()) {
      toast.warning("Informe a Base URL antes de carregar os modelos.");
      return;
    }
    setLoadingModels(true);
    try {
      const { models: list } = await listAiModels(accountId, probeBody());
      setModels(list);
      if (list.length === 0) toast.warning("Nenhum modelo retornado por este endpoint.");
    } catch (e) {
      toast.error(errMsg(e, "Não foi possível carregar os modelos"));
    } finally {
      setLoadingModels(false);
    }
  };
  useEffect(() => {
    if (!connection.base_url) return;
    listAiModels(accountId, {})
      .then(({ models: list }) => setModels(list))
      .catch(() => {
        /* o botão de recarregar mostra o erro */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const [temperature, setTemperature] = useState(settings.temperature);
  const [effort, setEffort] = useState(settings.effort || "default");
  const [language, setLanguage] = useState<"auto" | ReplyLanguage>(
    settings.reply_language || "auto",
  );
  const [turns, setTurns] = useState(settings.history_turns);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const hasConnection = baseUrl.trim() && model.trim();
    if (!hasConnection && (baseUrl.trim() || apiKey.trim() || model.trim())) {
      toast.warning("Informe a Base URL e o modelo para salvar a conexão.");
      return;
    }
    setSaving(true);
    try {
      if (hasConnection) {
        await saveAiConnection(accountId, {
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim() || undefined,
          modelId: model.trim(),
        });
      }
      await updateAiAgentSettings(accountId, {
        fallbackModels: fallbacks.map((f) => f.trim()).filter(Boolean),
        temperature,
        effort: effort === "default" ? "" : effort,
        replyLanguage: language === "auto" ? "" : language,
        historyTurns: Math.min(30, Math.max(1, Math.round(turns) || 8)),
      });
      toast.success("Comportamento salvo");
      setApiKey("");
      onSaved();
    } catch (e) {
      toast.error(errMsg(e, "Não foi possível salvar"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-5 rounded-xl border bg-card p-5">
      <h3 className="text-base font-semibold">Comportamento</h3>

      <div className="space-y-3">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Base URL</Label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
            <p className="text-xs text-muted-foreground">
              Qualquer endpoint compatível com a API da OpenAI (OpenAI, Groq, DeepSeek, Mistral,
              Ollama, um servidor próprio…).
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>
              API Key{" "}
              <span className="text-muted-foreground">
                {connection.has_key ? "(já salva)" : "(opcional)"}
              </span>
            </Label>
            <div className="flex gap-2">
              <Input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={connection.has_key ? "Deixe em branco para manter" : "Cole a chave"}
                autoComplete="off"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setShowKey((s) => !s)}
                aria-label={showKey ? "Ocultar chave" : "Mostrar chave"}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Modelo</Label>
          <div className="flex gap-2">
            <Input
              list="ai-models"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Ex.: gpt-4o-mini"
            />
            <datalist id="ai-models">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={loadingModels}
              onClick={loadModels}
              title="Carregar modelos"
            >
              {loadingModels ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={testing}
              onClick={async () => {
                if (!baseUrl.trim() || !model.trim()) {
                  toast.warning("Informe a Base URL e o modelo antes de testar.");
                  return;
                }
                setTesting(true);
                try {
                  const r = await testAiConnection(accountId, {
                    ...probeBody(),
                    modelId: model.trim(),
                  });
                  toast.success(r.message || "IA Agent respondeu");
                } catch (e) {
                  toast.error(errMsg(e, "Falha no teste"));
                } finally {
                  setTesting(false);
                }
              }}
            >
              {testing ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <PlayCircle className="mr-1 h-4 w-4" />
              )}
              Testar
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <Label>Fallback automático</Label>
              <p className="text-xs text-muted-foreground">
                Se o modelo falhar ou demorar demais, o agente tenta estes, em ordem.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={fallbacks.length >= MAX_FALLBACKS}
              onClick={() => setFallbacks((f) => [...f, ""])}
            >
              <Plus className="mr-1 h-4 w-4" /> Adicionar
            </Button>
          </div>
          {fallbacks.map((f, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 text-center text-xs text-muted-foreground">{i + 1}</span>
              <Input
                list="ai-models"
                value={f}
                onChange={(e) =>
                  setFallbacks((list) => list.map((x, j) => (j === i ? e.target.value : x)))
                }
                placeholder="Modelo de fallback"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remover fallback"
                onClick={() => setFallbacks((list) => list.filter((_, j) => j !== i))}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Temperatura</Label>
          <span className="text-sm tabular-nums text-muted-foreground">
            {temperature.toFixed(1)}
          </span>
        </div>
        <Slider
          min={0}
          max={2}
          step={0.1}
          value={[temperature]}
          onValueChange={([v]) => setTemperature(v)}
        />
        <p className="text-xs text-muted-foreground">
          Baixa = respostas consistentes e objetivas; alta = mais variação e criatividade.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Esforço (raciocínio)</Label>
          <Select value={effort} onValueChange={setEffort}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EFFORTS.map((e) => (
                <SelectItem key={e.value} value={e.value}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Só vale para modelos que aceitam esforço; mais alto = mais lento.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Idioma da resposta</Label>
          <Select value={language} onValueChange={(v) => setLanguage(v as "auto" | ReplyLanguage)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((l) => (
                <SelectItem key={l.value} value={l.value}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Mensagens de contexto</Label>
          <Input
            type="number"
            min={1}
            max={30}
            value={turns}
            onChange={(e) => setTurns(Number(e.target.value))}
          />
          <p className="text-xs text-muted-foreground">
            Quantas mensagens anteriores o agente lê (1–30).
          </p>
        </div>
      </div>

      <Button size="sm" disabled={saving} onClick={save}>
        {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
        Salvar comportamento
      </Button>
    </section>
  );
}

export function InstructionsCard({
  accountId,
  value,
  onSaved,
}: {
  accountId: string;
  value: string;
  onSaved: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <section className="space-y-3 rounded-xl border bg-card p-5">
      <h3 className="text-base font-semibold">Instruções do atendimento</h3>
      <Textarea
        rows={6}
        value={text ?? value}
        onChange={(e) => setText(e.target.value)}
        placeholder="Ex.: Você é a assistente da empresa X. Seja cordial, objetiva e passe para um humano quando o cliente pedir."
      />
      <Button
        size="sm"
        disabled={text === null || saving}
        onClick={async () => {
          setSaving(true);
          try {
            await updateAiAgentSettings(accountId, { systemPrompt: text ?? "" });
            setText(null);
            onSaved();
          } catch (e) {
            toast.error(errMsg(e, "Não foi possível salvar"));
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
        Salvar instruções
      </Button>
    </section>
  );
}

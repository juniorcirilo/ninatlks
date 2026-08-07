import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Bot,
  MessageSquare,
  Mic,
  Cpu,
  Settings2,
  BookOpen,
  Cloud,
  Loader2,
  Save,
  Check,
  AlertCircle,
  X,
  Plus,
  Sparkles,
  Trash2,
  Copy,
  ExternalLink,
  FileText,
  Link2,
  Webhook,
  Database,
} from "lucide-react";
import {
  updatePersona,
  deletePersona,
  syncElevenLabsAgent,
  addKnowledgeBaseText,
  addKnowledgeBaseUrl,
  type Persona,
  type PersonaVariableField,
} from "@/lib/personas";
import { VoicePicker } from "@/components/personas/VoicePicker";
import { AgentWebhooksTab } from "@/components/personas/AgentWebhooksTab";
import { DEFAULT_SDR_PROMPT, FIRST_MESSAGE_TEMPLATE } from "@/lib/sdr-agent-prompt";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Tab =
  | "conversa"
  | "voz"
  | "modelo"
  | "comportamento"
  | "dados"
  | "conhecimento"
  | "webhooks"
  | "sync";

const TABS: {
  id: Tab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  desc: string;
}[] = [
  { id: "conversa", label: "Conversa", icon: MessageSquare, desc: "Prompt e fala de abertura" },
  { id: "voz", label: "Voz", icon: Mic, desc: "Voz, estabilidade, velocidade" },
  { id: "modelo", label: "Modelo", icon: Cpu, desc: "LLM, temperatura, tokens" },
  { id: "comportamento", label: "Comportamento", icon: Settings2, desc: "Pausas, timeout, ASR" },
  { id: "dados", label: "Dados", icon: Database, desc: "Campos de contato deste agente" },
  { id: "conhecimento", label: "Conhecimento", icon: BookOpen, desc: "RAG: docs e URLs" },
  { id: "webhooks", label: "Webhooks", icon: Webhook, desc: "Destinos de eventos (n8n, CRM…)" },
  { id: "sync", label: "Sincronização", icon: Cloud, desc: "ElevenLabs + status" },
];

const LLM_MODELS = [
  { value: "gpt-4o-mini", label: "GPT-4o mini", hint: "rápido, custo baixo (recomendado)" },
  { value: "gpt-4o", label: "GPT-4o", hint: "balanço qualidade × custo" },
  { value: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet", hint: "alta qualidade conversacional" },
  { value: "claude-3-5-haiku", label: "Claude 3.5 Haiku", hint: "velocidade alta" },
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash", hint: "muito rápido, multimodal" },
  { value: "custom-llm", label: "IA própria (conta)", hint: "usa o Provedor de IA do Agente configurado em Integrações — OpenAI, Gemini, Groq, LM Studio etc." },
];

export function AgentEditor({
  open,
  persona,
  accountId,
  onClose,
  onSaved,
}: {
  open: boolean;
  persona: Persona | null;
  accountId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState<Tab>("conversa");
  const [draft, setDraft] = useState<Persona | null>(persona);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraft(persona);
    setDirty(false);
    setTab("conversa");
  }, [persona?.id]);

  const update = <K extends keyof Persona>(key: K, value: Persona[K]) => {
    if (!draft) return;
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setDirty(true);
  };

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      await updatePersona(accountId, draft.id, {
        name: draft.name,
        description: draft.description,
        system_prompt: draft.system_prompt,
        first_message: draft.first_message,
        voice_clone_id: draft.voice_clone_id,
        voice_provider: draft.voice_provider,
        voice_config: draft.voice_config,
        tts_config: draft.tts_config,
        turn_config: draft.turn_config,
        asr_keywords: draft.asr_keywords,
        llm_temperature: draft.llm_temperature,
        llm_max_tokens: draft.llm_max_tokens,
        llm_model: draft.llm_model,
        llm_custom_url: draft.llm_custom_url,
        llm_custom_model_id: draft.llm_custom_model_id,
        status: draft.status,
        enabled: draft.enabled,
        variable_schema: (draft.variable_schema ?? [])
          .map((f) => ({ ...f, field: f.field.trim() }))
          .filter((f) => f.field),
      });
      // Auto-sync com ElevenLabs após salvar — evita que o agente continue
      // rodando com prompt/voz/modelo antigos no EL.
      try {
        await syncElevenLabsAgent(accountId, draft.id);
        toast.success("Salvo e sincronizado com a voz");
      } catch (syncErr) {
        const sm = syncErr instanceof Error ? syncErr.message : "erro desconhecido";
        toast.warning(
          `Salvo, mas falha ao sincronizar voz: ${sm.slice(0, 140)}. Use 'Re-sincronizar' na aba Sincronização.`,
        );
      }
      setDirty(false);
      onSaved();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro";
      toast.error(`Falha ao salvar: ${msg.slice(0, 200)}`);
    } finally {
      setSaving(false);
    }
  };

  if (!draft) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="!max-w-5xl p-0 overflow-hidden">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500">
                <Bot className="h-4 w-4 text-white" />
              </div>
              <div>
                <div className="text-base font-semibold">{draft.name || "Agente sem nome"}</div>
                <div className="text-[11px] font-normal text-muted-foreground">
                  {draft.description || "Configure prompt, voz e comportamento"}
                </div>
              </div>
            </div>
            <SaveBar dirty={dirty} saving={saving} onSave={save} />
          </DialogTitle>
        </DialogHeader>

        <div className="flex h-[75vh] min-h-[500px]">
          {/* Sidebar */}
          <nav className="flex w-56 shrink-0 flex-col border-r border-border bg-muted/40 p-3">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "mb-1 flex items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-colors",
                    active
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", active && "text-primary")} />
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium">{t.label}</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground line-clamp-1">
                      {t.desc}
                    </div>
                  </div>
                </button>
              );
            })}

            <div className="mt-auto pt-2">
              <DangerZone
                persona={draft}
                onDeleted={() => {
                  onSaved();
                  onClose();
                }}
              />
            </div>
          </nav>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {tab === "conversa" && <ConversaTab draft={draft} update={update} />}
            {tab === "voz" && <VozTab draft={draft} update={update} accountId={accountId} />}
            {tab === "modelo" && <ModeloTab draft={draft} update={update} />}
            {tab === "comportamento" && <ComportamentoTab draft={draft} update={update} />}
            {tab === "dados" && <DadosTab draft={draft} update={update} />}
            {tab === "conhecimento" && (
              <ConhecimentoTab draft={draft} accountId={accountId} onChanged={onSaved} />
            )}
            {tab === "webhooks" && (
              <AgentWebhooksTab agentId={draft.id} agentName={draft.name} accountId={accountId} />
            )}
            {tab === "sync" && <SyncTab draft={draft} onSynced={onSaved} accountId={accountId} />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────
// SaveBar (header)
// ──────────────────────────────────────────────────────────────────

function SaveBar({
  dirty,
  saving,
  onSave,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "rounded-md px-2 py-0.5 text-[10px] font-medium",
          dirty ? "bg-amber-500/15 text-amber-400" : "bg-emerald-500/15 text-emerald-400",
        )}
      >
        {dirty ? "Não salvo" : "Salvo"}
      </span>
      <Button size="sm" onClick={onSave} disabled={!dirty || saving} className="gap-1.5">
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Save className="h-3.5 w-3.5" />
        )}
        Salvar
      </Button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Tab: Conversa
// ──────────────────────────────────────────────────────────────────

function ConversaTab({
  draft,
  update,
}: {
  draft: Persona;
  update: <K extends keyof Persona>(k: K, v: Persona[K]) => void;
}) {
  const loadTemplate = () => {
    update("system_prompt", DEFAULT_SDR_PROMPT);
    update("first_message", FIRST_MESSAGE_TEMPLATE);
    toast.success("Template de SDR carregado. Ajuste o que precisar.");
  };

  return (
    <div className="space-y-6">
      <Section title="Identidade" desc="Nome interno do agente e descrição rápida.">
        <FieldRow label="Nome">
          <Input value={draft.name} onChange={(e) => update("name", e.target.value)} />
        </FieldRow>
        <FieldRow label="Descrição">
          <Textarea
            value={draft.description ?? ""}
            onChange={(e) => update("description", e.target.value)}
            rows={2}
            placeholder="Para que serve esse agente — ex: SDR inbound qualificando leads de SaaS B2B"
          />
        </FieldRow>
      </Section>

      <Section
        title="System prompt"
        desc="Instruções completas para o agente. Variáveis dinâmicas {{nome}} são substituídas a cada chamada."
        action={
          <Button size="sm" variant="outline" onClick={loadTemplate} className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Carregar template de SDR
          </Button>
        }
      >
        <Textarea
          value={draft.system_prompt ?? ""}
          onChange={(e) => update("system_prompt", e.target.value)}
          rows={18}
          className="font-mono text-[12px] leading-relaxed"
          placeholder="Você é um SDR por voz que..."
        />
        <div className="mt-2 flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-[11px] text-muted-foreground">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
          <span>
            O template de SDR já cobre o fluxo completo: descoberta, qualificação BANT, agendamento
            via tool, briefing pro humano e tratamento de objeções. Edite com cuidado se for
            ajustar.
          </span>
        </div>
      </Section>

      <Section
        title="Primeira mensagem"
        desc="Frase de abertura. Pode usar {{lead_name}}, {{company_name}}, {{agent_name}}."
      >
        <Textarea
          value={draft.first_message ?? ""}
          onChange={(e) => update("first_message", e.target.value)}
          rows={3}
          placeholder="Oi {{lead_name}}, aqui é {{agent_name}} da {{company_name}}…"
        />
      </Section>

      <Section title="Status" desc="Apenas agentes ativos rodam em campanhas.">
        <div className="flex items-center gap-3">
          <Switch checked={draft.enabled} onCheckedChange={(v) => update("enabled", v)} />
          <span className="text-[12px] text-muted-foreground">
            {draft.enabled ? "Ativo" : "Desativado"}
          </span>
        </div>
      </Section>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Tab: Voz
// ──────────────────────────────────────────────────────────────────

function VozTab({
  draft,
  update,
  accountId,
}: {
  draft: Persona;
  update: <K extends keyof Persona>(k: K, v: Persona[K]) => void;
  accountId: string;
}) {
  const tts = (draft.tts_config ?? {}) as {
    stability?: number;
    speed?: number;
    similarity_boost?: number;
  };

  return (
    <div className="space-y-6">
      <Section
        title="Voz ElevenLabs"
        desc="Escolha uma voz da biblioteca, faça preview ou clone uma voz própria a partir de áudio."
      >
        <VoicePicker
          personaId={draft.id}
          accountId={accountId}
          currentVoiceId={draft.voice_clone_id}
          onSaved={(voiceId) => {
            // VoicePicker já persistiu no banco; sincroniza o draft local
            // pra que o próximo "Salvar" do editor não sobrescreva com null.
            update("voice_clone_id", voiceId);
            update("voice_provider", "elevenlabs");
          }}
        />
      </Section>

      <Section
        title="Ajustes de TTS"
        desc="Ajustes finos do modelo de fala. Defaults da ElevenLabs costumam funcionar bem."
      >
        <SliderField
          label="Estabilidade"
          desc="Mais alto = entonação mais consistente. Mais baixo = mais expressivo."
          min={0}
          max={1}
          step={0.05}
          value={tts.stability ?? 0.5}
          onChange={(v) => update("tts_config", { ...tts, stability: v })}
          format={(v) => v.toFixed(2)}
        />
        <SliderField
          label="Boost de similaridade"
          desc="Quanto a voz fica próxima da original (especialmente em clones)."
          min={0}
          max={1}
          step={0.05}
          value={tts.similarity_boost ?? 0.75}
          onChange={(v) => update("tts_config", { ...tts, similarity_boost: v })}
          format={(v) => v.toFixed(2)}
        />
        <SliderField
          label="Velocidade"
          desc="0.7× (lento, mais natural) a 1.2× (rápido, mais comercial)."
          min={0.7}
          max={1.2}
          step={0.05}
          value={tts.speed ?? 1.0}
          onChange={(v) => update("tts_config", { ...tts, speed: v })}
          format={(v) => `${v.toFixed(2)}×`}
        />
      </Section>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Tab: Modelo
// ──────────────────────────────────────────────────────────────────

function ModeloTab({
  draft,
  update,
}: {
  draft: Persona;
  update: <K extends keyof Persona>(k: K, v: Persona[K]) => void;
}) {
  // Trocar pra um modelo que não seja "IA própria" tem que esvaziar a
  // URL/model_id customizados — senão o valor fica órfão salvo no banco
  // (não afeta a chamada, já que só é lido quando llm_model === "custom-llm",
  // mas confunde quem olha os dados achando que agentes estão compartilhando
  // configuração).
  const selectModel = (value: string) => {
    update("llm_model", value);
    if (value !== "custom-llm") {
      update("llm_custom_url", null);
      update("llm_custom_model_id", null);
    }
  };

  return (
    <div className="space-y-6">
      <Section
        title="Modelo de linguagem"
        desc="O LLM que vai compor as respostas do agente em tempo real."
      >
        <div className="grid grid-cols-1 gap-2">
          {LLM_MODELS.map((m) => {
            const active = draft.llm_model === m.value;
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => selectModel(m.value)}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                  active
                    ? "border-primary bg-primary/10"
                    : "border-border bg-muted/40 hover:border-border",
                )}
              >
                <div
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0 rounded-full border-2",
                    active ? "border-primary bg-primary" : "border-white/20",
                  )}
                >
                  {active && <Check className="h-3 w-3 text-primary-foreground" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium">{m.label}</div>
                  <div className="text-[11px] text-muted-foreground">{m.hint}</div>
                </div>
                <code className="ml-2 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {m.value}
                </code>
              </button>
            );
          })}
        </div>
      </Section>

      {draft.llm_model === "custom-llm" && (
        <Section
          title="Servidor da IA própria"
          desc='Em branco, usa o padrão da conta (Configurações → Integrações → "Provedor de IA do Agente"). Preencha aqui só se este agente precisar de uma URL ou modelo diferente — atenção: esse override só funciona com endpoints no formato OpenAI (não com Anthropic/Claude).'
        >
          <FieldRow label="URL do servidor (opcional — substitui o padrão)">
            <Input
              value={draft.llm_custom_url ?? ""}
              onChange={(e) => update("llm_custom_url", e.target.value || null)}
              placeholder="http://seu-host:1234/v1"
              className="font-mono text-[12px]"
            />
          </FieldRow>
          <FieldRow label="Model ID (opcional — substitui o padrão)">
            <Input
              value={draft.llm_custom_model_id ?? ""}
              onChange={(e) => update("llm_custom_model_id", e.target.value || null)}
              placeholder="nome-do-modelo-carregado"
              className="font-mono text-[12px]"
            />
          </FieldRow>
          <p className="text-[10px] text-muted-foreground">
            A API key é sempre a da conta (não dá pra ter uma por agente) — configure em
            Configurações → Integrações → Provedor de IA do Agente.
          </p>
        </Section>
      )}

      <Section
        title="Temperatura"
        desc="0 = determinístico (sempre mesma resposta). 1 = criativo. Para SDR, 0.4-0.6 é o sweet spot."
      >
        <SliderField
          label="Temperatura"
          min={0}
          max={1}
          step={0.05}
          value={Number(draft.llm_temperature ?? 0.5)}
          onChange={(v) => update("llm_temperature", v)}
          format={(v) => v.toFixed(2)}
        />
      </Section>

      <Section
        title="Tamanho da resposta"
        desc="Máximo de tokens em uma resposta. Em chamada, respostas curtas (200-400) são melhores."
      >
        <SliderField
          label="Máx. tokens"
          min={50}
          max={1000}
          step={50}
          value={Number(draft.llm_max_tokens ?? 300)}
          onChange={(v) => update("llm_max_tokens", v)}
          format={(v) => `${v}`}
        />
      </Section>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Tab: Comportamento
// ──────────────────────────────────────────────────────────────────

const EAGERNESS_OPTIONS: { value: "cautious" | "normal" | "eager"; label: string; hint: string }[] =
  [
    {
      value: "cautious",
      label: "Cauteloso",
      hint: "espera mais o devedor terminar — bom pra evitar atropelos",
    },
    { value: "normal", label: "Normal", hint: "balanço entre interromper e esperar" },
    {
      value: "eager",
      label: "Ágil",
      hint: "responde rápido — pode soar mais natural mas atropela mais",
    },
  ];

function ComportamentoTab({
  draft,
  update,
}: {
  draft: Persona;
  update: <K extends keyof Persona>(k: K, v: Persona[K]) => void;
}) {
  const turn = (draft.turn_config ?? {}) as {
    turn_timeout?: number;
    turn_eagerness?: "cautious" | "normal" | "eager";
    silence_end_call_timeout?: number;
  };
  const [keywordInput, setKeywordInput] = useState("");
  const keywords = draft.asr_keywords ?? [];

  const addKeyword = () => {
    const k = keywordInput.trim();
    if (!k) return;
    if (keywords.includes(k)) {
      setKeywordInput("");
      return;
    }
    update("asr_keywords", [...keywords, k]);
    setKeywordInput("");
  };

  const removeKeyword = (k: string) => {
    update(
      "asr_keywords",
      keywords.filter((x) => x !== k),
    );
  };

  return (
    <div className="space-y-6">
      <Section
        title="Tomada de turno"
        desc="Como o agente decide quando começar a falar depois do devedor."
      >
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {EAGERNESS_OPTIONS.map((o) => {
            const active = (turn.turn_eagerness ?? "normal") === o.value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => update("turn_config", { ...turn, turn_eagerness: o.value })}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  active
                    ? "border-primary bg-primary/10"
                    : "border-border bg-muted/40 hover:border-border",
                )}
              >
                <div className="text-[13px] font-medium">{o.label}</div>
                <div className="mt-1 text-[10px] text-muted-foreground">{o.hint}</div>
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        title="Tempos"
        desc="Tempos em segundos. Defaults do ElevenLabs costumam ser bons — ajuste só se notar problemas."
      >
        <SliderField
          label="Turn timeout"
          desc="Quanto o agente espera o devedor terminar antes de assumir que pode falar."
          min={1}
          max={20}
          step={1}
          value={Number(turn.turn_timeout ?? 7)}
          onChange={(v) => update("turn_config", { ...turn, turn_timeout: v })}
          format={(v) => `${v}s`}
        />
        <SliderField
          label="Silêncio que encerra a chamada"
          desc="Se o devedor ficar mudo por X segundos, encerra a ligação."
          min={5}
          max={120}
          step={5}
          value={Number(turn.silence_end_call_timeout ?? 30)}
          onChange={(v) => update("turn_config", { ...turn, silence_end_call_timeout: v })}
          format={(v) => `${v}s`}
        />
      </Section>

      <Section
        title="Palavras-chave do ASR"
        desc="Lista de termos pra reforçar no reconhecimento de voz. Ajuda quando o devedor fala nomes próprios, marcas, números específicos."
      >
        <div className="mb-2 flex flex-wrap gap-1.5">
          {keywords.length === 0 && (
            <span className="text-[11px] text-muted-foreground">
              Nenhuma palavra-chave configurada.
            </span>
          )}
          {keywords.map((k) => (
            <span
              key={k}
              className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] text-primary"
            >
              {k}
              <button
                type="button"
                onClick={() => removeKeyword(k)}
                className="hover:text-rose-400"
                aria-label={`Remover ${k}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addKeyword();
              }
            }}
            placeholder='Ex: "Asaas", "PIX", "Serasa"'
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            onClick={addKeyword}
            disabled={!keywordInput.trim()}
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar
          </Button>
        </div>
      </Section>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Tab: Dados (campos de contato deste agente)
// ──────────────────────────────────────────────────────────────────

/**
 * O que a lista operacional precisa saber sobre um contato pra este agente
 * ligar (ex.: Diego/cobrança quer dias_em_atraso e valor_devedor_saldo;
 * Sofia/orçamentos quer numero_orcamento e status_orcamento). Cadastrado uma
 * vez aqui, reaproveitado no formulário de "adicionar contato específico" em
 * Listas e no template de webhook/n8n deste agente — sem isso, toda lista
 * mostrava o mesmo conjunto genérico de campos.
 */
function DadosTab({
  draft,
  update,
}: {
  draft: Persona;
  update: <K extends keyof Persona>(k: K, v: Persona[K]) => void;
}) {
  const fields = draft.variable_schema ?? [];

  const setFields = (next: PersonaVariableField[]) => update("variable_schema", next);
  const updateField = (i: number, patch: Partial<PersonaVariableField>) => {
    setFields(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  };

  return (
    <div className="space-y-6">
      <Section
        title="Campos de contato"
        desc={
          'Definem o formulário de "adicionar contato específico" ao criar uma lista para este ' +
          "agente, e o template de webhook/n8n baixado em Configurações → Integrações."
        }
      >
        {fields.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-[11px] text-muted-foreground">
            Nenhum campo cadastrado ainda — a lista vai usar um conjunto genérico por tipo de
            operação até você adicionar os campos deste agente aqui.
          </div>
        ) : (
          <ul className="space-y-2">
            {fields.map((f, i) => (
              <li key={i} className="rounded-lg border border-border bg-muted/40 p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <FieldRow label="Chave">
                    <Input
                      value={f.field}
                      onChange={(e) => updateField(i, { field: e.target.value })}
                      placeholder="dias_em_atraso"
                      className="font-mono text-[12px]"
                    />
                  </FieldRow>
                  <FieldRow label="Rótulo (o que é)">
                    <Input
                      value={f.desc}
                      onChange={(e) => updateField(i, { desc: e.target.value })}
                      placeholder="Dias corridos desde o vencimento"
                    />
                  </FieldRow>
                </div>
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <FieldRow label="Exemplo (opcional)">
                      <Input
                        value={f.example != null ? String(f.example) : ""}
                        onChange={(e) => updateField(i, { example: e.target.value })}
                        placeholder="20"
                      />
                    </FieldRow>
                  </div>
                  <label className="mb-3 flex shrink-0 items-center gap-1.5 text-[11px]">
                    <input
                      type="checkbox"
                      checked={f.required}
                      onChange={(e) => updateField(i, { required: e.target.checked })}
                      className="h-3.5 w-3.5"
                    />
                    Obrigatório
                  </label>
                  <button
                    type="button"
                    onClick={() => setFields(fields.filter((_, j) => j !== i))}
                    className="mb-3 shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-rose-400"
                    aria-label="Remover campo"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setFields([...fields, { field: "", desc: "", required: false, example: "" }])
          }
          className="mt-3 gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar campo
        </Button>
      </Section>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Tab: Conhecimento (RAG)
// ──────────────────────────────────────────────────────────────────

function ConhecimentoTab({
  draft,
  accountId,
  onChanged,
}: {
  draft: Persona;
  accountId: string;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<"text" | "url">("text");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);

  const synced = Boolean(draft.elevenlabs_agent_id);
  const docs = draft.elevenlabs_knowledge_base_ids ?? [];

  const submit = async () => {
    if (adding || !name.trim()) return;
    if (!synced) {
      toast.error("Sincronize o agente com ElevenLabs antes de adicionar conhecimento");
      return;
    }
    setAdding(true);
    try {
      if (mode === "text") {
        if (!text.trim()) {
          toast.error("Texto vazio");
          return;
        }
        await addKnowledgeBaseText({
          accountId,
          personaId: draft.id,
          name: name.trim(),
          text: text.trim(),
        });
      } else {
        if (!url.trim()) {
          toast.error("URL vazia");
          return;
        }
        await addKnowledgeBaseUrl({
          accountId,
          personaId: draft.id,
          name: name.trim(),
          url: url.trim(),
        });
      }
      toast.success("Documento adicionado à base");
      setName("");
      setText("");
      setUrl("");
      onChanged();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro";
      toast.error(`Falha: ${msg.slice(0, 200)}`);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-6">
      <Section
        title="Base de conhecimento (RAG)"
        desc="Documentos que o agente consulta durante a chamada. Útil pra políticas internas, scripts especiais, FAQ."
      >
        {!synced && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/15 p-3 text-[11px] text-amber-400">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              Você precisa sincronizar o agente com ElevenLabs antes de adicionar documentos. Vá em{" "}
              <strong>Sincronização</strong>.
            </div>
          </div>
        )}

        <div className="rounded-lg border border-border bg-muted/40 p-4">
          <div className="mb-3 flex gap-1.5">
            <button
              type="button"
              onClick={() => setMode("text")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] transition-colors",
                mode === "text"
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground hover:bg-muted",
              )}
            >
              <FileText className="h-3.5 w-3.5" />
              Texto
            </button>
            <button
              type="button"
              onClick={() => setMode("url")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] transition-colors",
                mode === "url"
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground hover:bg-muted",
              )}
            >
              <Link2 className="h-3.5 w-3.5" />
              URL
            </button>
          </div>

          <div className="space-y-3">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome do documento (ex: Política de descontos 2026)"
              disabled={!synced}
            />
            {mode === "text" ? (
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={6}
                placeholder="Cole aqui o conteúdo de referência…"
                disabled={!synced}
              />
            ) : (
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://exemplo.com/politica.pdf"
                disabled={!synced}
              />
            )}

            <Button
              onClick={submit}
              disabled={
                !synced || adding || !name.trim() || (mode === "text" ? !text.trim() : !url.trim())
              }
              className="gap-1.5"
            >
              {adding ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Adicionar à base
            </Button>
          </div>
        </div>
      </Section>

      <Section
        title="Documentos no agente"
        desc={`${docs.length} documento${docs.length === 1 ? "" : "s"} indexado${docs.length === 1 ? "" : "s"} no ElevenLabs.`}
      >
        {docs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-[11px] text-muted-foreground">
            Nenhum documento adicionado ainda.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {docs.map((id) => (
              <li
                key={id}
                className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px]"
              >
                <BookOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
                <code className="flex-1 truncate font-mono text-muted-foreground">{id}</code>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Tab: Sincronização
// ──────────────────────────────────────────────────────────────────

function SyncTab({ draft, onSynced, accountId }: { draft: Persona; onSynced: () => void; accountId: string }) {
  const [syncing, setSyncing] = useState(false);
  const synced = Boolean(draft.elevenlabs_agent_id);

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const r = await syncElevenLabsAgent(accountId, draft.id);
      toast.success(`Agente sincronizado: ${r.elevenlabs_agent_id.slice(0, 12)}…`);
      onSynced();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro";
      toast.error(`Falha ao sincronizar: ${msg.slice(0, 200)}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      <Section
        title="Sincronização com ElevenLabs"
        desc="Cria (ou atualiza) um agente conversacional na sua conta ElevenLabs com a configuração atual: prompt, voz, modelo, comportamento."
      >
        <div
          className={cn(
            "rounded-lg border p-4",
            synced ? "border-emerald-500/40 bg-emerald-500/15" : "border-amber-500/40 bg-amber-500/15",
          )}
        >
          <div className="flex items-start gap-3">
            {synced ? (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            )}
            <div className="flex-1">
              <div className="text-[13px] font-medium">
                {synced ? "Sincronizado com ElevenLabs" : "Ainda não sincronizado"}
              </div>
              {synced ? (
                <div className="mt-1 flex items-center gap-2">
                  <code className="font-mono text-[11px] text-muted-foreground">
                    agent_id: {draft.elevenlabs_agent_id}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(draft.elevenlabs_agent_id ?? "");
                      toast.success("Copiado");
                    }}
                    className="rounded p-1 text-muted-foreground hover:text-foreground"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <p className="mt-1 text-[11px] text-amber-400/80">
                  Antes de rodar campanhas com este agente, sincronize com a ElevenLabs.
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <Button onClick={handleSync} disabled={syncing} className="gap-1.5">
              {syncing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Cloud className="h-3.5 w-3.5" />
              )}
              {synced ? "Re-sincronizar" : "Sincronizar agora"}
            </Button>
            {synced && (
              <a
                href={`https://elevenlabs.io/app/conversational-ai/agents/${draft.elevenlabs_agent_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md bg-muted px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Abrir no ElevenLabs <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      </Section>

      <Section
        title="O que é enviado"
        desc="Configurações desta tela que vão pro ElevenLabs Conversational AI."
      >
        <ul className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
          <SyncItem ok={Boolean(draft.system_prompt)} label="System prompt" />
          <SyncItem ok={Boolean(draft.first_message)} label="Primeira mensagem" />
          <SyncItem ok={Boolean(draft.voice_clone_id)} label="Voz" />
          <SyncItem ok={Boolean(draft.llm_model)} label="Modelo LLM" />
          <SyncItem ok={Number(draft.llm_temperature ?? 0) >= 0} label="Temperatura" />
          <SyncItem ok={true} label={`${(draft.asr_keywords ?? []).length} palavras-chave ASR`} />
        </ul>
      </Section>
    </div>
  );
}

function SyncItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px]">
      {ok ? (
        <Check className="h-3 w-3 text-emerald-400" />
      ) : (
        <AlertCircle className="h-3 w-3 text-amber-400" />
      )}
      <span>{label}</span>
    </li>
  );
}

// ──────────────────────────────────────────────────────────────────
// Danger zone (delete)
// ──────────────────────────────────────────────────────────────────

function DangerZone({ persona, onDeleted }: { persona: Persona; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Excluir o agente "${persona.name}"? Essa ação é irreversível.`)) return;
    setDeleting(true);
    try {
      await deletePersona(persona.account_id, persona.id);
      toast.success("Agente excluído");
      onDeleted();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro";
      toast.error(`Falha ao excluir: ${msg.slice(0, 200)}`);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={deleting}
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[11px] text-rose-400/70 transition-colors hover:bg-rose-500/15 hover:text-rose-400"
    >
      {deleting ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Trash2 className="h-3.5 w-3.5" />
      )}
      Excluir agente
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function Section({
  title,
  desc,
  action,
  children,
}: {
  title: string;
  desc?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold">{title}</h3>
          {desc && <p className="mt-0.5 text-[11px] text-muted-foreground">{desc}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function SliderField({
  label,
  desc,
  value,
  onChange,
  min,
  max,
  step,
  format,
}: {
  label: string;
  desc?: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center justify-between">
        <div>
          <div className="text-[12px] font-medium">{label}</div>
          {desc && <div className="text-[10px] text-muted-foreground">{desc}</div>}
        </div>
        <code className="rounded-md bg-muted px-2 py-0.5 font-mono text-[11px] tabular-nums">
          {format(value)}
        </code>
      </div>
      <Slider
        value={[value]}
        onValueChange={(v) => onChange(v[0])}
        min={min}
        max={max}
        step={step}
      />
    </div>
  );
}

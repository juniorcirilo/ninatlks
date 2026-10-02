// Full-screen-ish modal for editing an agent: identity (name/description),
// brain (system prompt), voice (ElevenLabs picker), and inbox deployments.
// Replaces the previous inline Mic/Settings expansion — one click, one place.

import { useEffect, useState } from "react";
import {
  Bot,
  Loader2,
  Trash2,
  Sparkles,
  Zap,
  BookOpen,
  Plus,
  X,
  Wand2,
  Sliders,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  STATUS_LABELS,
  updatePersona,
  deletePersona,
  distillPersona,
  syncElevenLabsAgent,
  generatePersonaPrompt,
  type Persona,
  type PersonaStatus,
} from "@/lib/personas";
import { VoicePicker } from "./VoicePicker";
import { PersonaDeploymentsPanel } from "./PersonaDeploymentsPanel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type TabKey = "brain" | "voice" | "knowledge" | "advanced" | "channels";

const DEFAULT_PROMPT_HINT = `Você é a Nina, SDR por voz. Fale em português brasileiro.
Mantenha respostas curtas (1-2 frases por vez), tom profissional e direto.
Atende inbound, descobre o motivo do contato, qualifica o lead em 4-5 turnos
e propõe agendar uma reunião com um humano da equipe comercial.
Se o lead pedir desconto ou condição comercial, diga que quem fecha é o time.
Se o lead estiver irritado ou reclamando, ouve, valida e direciona para humano.`;

export function EditPersonaDialog({
  open,
  persona,
  accountId,
  onClose,
  onChanged,
}: {
  open: boolean;
  persona: Persona | null;
  accountId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<TabKey>("brain");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [status, setStatus] = useState<PersonaStatus>("active");
  const [saving, setSaving] = useState(false);
  const [distilling, setDistilling] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [kbUrl, setKbUrl] = useState("");
  const [kbText, setKbText] = useState("");
  const [kbName, setKbName] = useState("");
  const [kbTab, setKbTab] = useState<"url" | "text">("url");
  const [addingKb, setAddingKb] = useState(false);

  // Advanced tab state — initialized from persona on open.
  const [firstMessage, setFirstMessage] = useState("");
  const [turnTimeout, setTurnTimeout] = useState(3);
  const [turnEagerness, setTurnEagerness] = useState<"eager" | "normal" | "cautious">("eager");
  const [ttsStability, setTtsStability] = useState(0.35);
  const [ttsSpeed, setTtsSpeed] = useState(1.05);
  const [ttsSimilarity, setTtsSimilarity] = useState(0.85);
  const [asrKeywords, setAsrKeywords] = useState("");
  const [llmTemperature, setLlmTemperature] = useState(0.5);
  const [llmMaxTokens, setLlmMaxTokens] = useState(150);
  const [llmModel, setLlmModel] = useState("gemini-2.5-flash");

  // AI prompt generator modal.
  const [genOpen, setGenOpen] = useState(false);
  const [genDescription, setGenDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<string | null>(null);

  // Reset form whenever the dialog opens on a different persona.
  useEffect(() => {
    if (!open || !persona) return;
    setName(persona.name ?? "");
    setDescription(persona.description ?? "");
    setSystemPrompt(persona.system_prompt ?? "");
    setStatus(persona.status);
    setTab("brain");

    // Advanced config — defaults match the migration defaults so pre-migration
    // personas don't explode.
    setFirstMessage(persona.first_message ?? "");
    const tc = persona.turn_config ?? {};
    setTurnTimeout(typeof tc.turn_timeout === "number" ? tc.turn_timeout : 3);
    setTurnEagerness((tc.turn_eagerness as any) ?? "eager");
    const tts = persona.tts_config ?? {};
    setTtsStability(typeof tts.stability === "number" ? tts.stability : 0.35);
    setTtsSpeed(typeof tts.speed === "number" ? tts.speed : 1.05);
    setTtsSimilarity(typeof tts.similarity_boost === "number" ? tts.similarity_boost : 0.85);
    setAsrKeywords((persona.asr_keywords ?? []).join(", "));
    setLlmTemperature(persona.llm_temperature ?? 0.5);
    setLlmMaxTokens(
      persona.llm_max_tokens && persona.llm_max_tokens >= 200 ? persona.llm_max_tokens : 400,
    );
    setLlmModel(persona.llm_model ?? "gemini-2.5-flash");
  }, [open, persona]);

  if (!persona) return null;

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    setSaving(true);
    try {
      await updatePersona(accountId, persona.id, {
        name: name.trim(),
        description: description.trim() || null,
        system_prompt: systemPrompt.trim() || null,
        status,
        first_message: firstMessage.trim() || null,
        turn_config: {
          turn_timeout: turnTimeout,
          turn_eagerness: turnEagerness,
          silence_end_call_timeout: 30,
        },
        tts_config: {
          stability: ttsStability,
          speed: ttsSpeed,
          similarity_boost: ttsSimilarity,
        },
        asr_keywords: asrKeywords
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        llm_temperature: llmTemperature,
        llm_max_tokens: llmMaxTokens,
        llm_model: llmModel,
      } as any);
      // Auto-sync com ElevenLabs após salvar — garante que o agente na ligação
      // use o prompt/voz/modelo recém editados (sem precisar do botão manual).
      try {
        await syncElevenLabsAgent(accountId, persona.id);
        toast.success("Salvo e sincronizado com a voz");
      } catch (syncErr: any) {
        const sm = syncErr?.message ?? "erro desconhecido";
        toast.warning(
          `Salvo, mas falha ao sincronizar voz: ${String(sm).slice(0, 140)}. Use 'Re-sincronizar' pra tentar de novo.`,
        );
      }
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    if (!genDescription.trim()) {
      toast.error("Descreve em poucas palavras o que a IA deve fazer");
      return;
    }
    setGenerating(true);
    setGenResult(null);
    try {
      const prompt = await generatePersonaPrompt(accountId, persona!.id, {
        description: genDescription.trim(),
        personaName: name.trim() || persona!.name,
        existingPrompt: systemPrompt.trim() || undefined,
        refine: !!systemPrompt.trim(),
      });
      setGenResult(prompt);
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao gerar prompt");
    } finally {
      setGenerating(false);
    }
  };

  const handleUseGenerated = () => {
    if (genResult) {
      setSystemPrompt(genResult);
      setGenOpen(false);
      setGenResult(null);
      setGenDescription("");
      toast.success("Prompt aplicado — clique Salvar pra persistir");
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Excluir agente "${persona.name}"? Ação irreversível.`)) return;
    try {
      await deletePersona(accountId, persona.id);
      toast.success("Agente excluído");
      onChanged();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao excluir");
    }
  };

  const handleElSync = async () => {
    // Save first, then sync to EL so the latest prompt/voice is pushed.
    setSyncing(true);
    try {
      // Persist current form state before syncing.
      await updatePersona(accountId, persona!.id, {
        name: name.trim(),
        description: description.trim() || null,
        system_prompt: systemPrompt.trim() || null,
        status,
      });
      const result = await syncElevenLabsAgent(accountId, persona!.id);
      toast.success(
        `Agente ElevenLabs sincronizado — ID: ${result.elevenlabs_agent_id.slice(0, 12)}…`,
      );
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao sincronizar com ElevenLabs");
    } finally {
      setSyncing(false);
    }
  };

  const handleDistill = async () => {
    setDistilling(true);
    try {
      const r = await distillPersona(accountId, persona.id);
      toast.success(`Estilo re-destilado de ${r.sampleCount} mensagens`);
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao treinar");
    } finally {
      setDistilling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-gradient-primary p-2">
              <Bot className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-left">
                {persona.name || "Agente sem nome"}
              </DialogTitle>
              <DialogDescription className="flex items-center gap-2 text-left">
                <Badge className="text-[10px]">{STATUS_LABELS[persona.status]}</Badge>
                <span className="text-[11px] text-muted-foreground">
                  v{persona.version} · {persona.sample_count} amostras
                </span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex items-center gap-1 border-b border-gray-200 dark:border-slate-800">
          {(
            [
              { key: "brain", label: "Cérebro" },
              { key: "voice", label: "Voz" },
              { key: "knowledge", label: "Conhecimento" },
              { key: "advanced", label: "Avançado" },
              { key: "channels", label: "Canais" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "relative px-3 py-2 text-[12px] transition-colors",
                tab === t.key ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {tab === t.key && <span className="absolute inset-x-2 bottom-0 h-px bg-primary" />}
            </button>
          ))}
        </div>

        <div className="max-h-[56vh] space-y-3 overflow-y-auto py-2">
          {tab === "brain" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="ep-name">Nome</Label>
                <Input
                  id="ep-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Nina (SDR)"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep-desc">Descrição curta</Label>
                <Input
                  id="ep-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ex: Qualifica leads do WhatsApp e Instagram"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="ep-prompt">Instruções (system prompt)</Label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setGenDescription("");
                        setGenResult(null);
                        setGenOpen(true);
                      }}
                      className="flex items-center gap-1 text-[11px] text-primary hover:text-primary"
                      title="Gera ou refina o prompt com IA a partir de uma descrição curta"
                    >
                      <Wand2 className="h-3 w-3" />
                      {systemPrompt ? "refinar com IA" : "gerar com IA"}
                    </button>
                    {!systemPrompt && (
                      <button
                        type="button"
                        onClick={() => setSystemPrompt(DEFAULT_PROMPT_HINT)}
                        className="text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        usar exemplo
                      </button>
                    )}
                  </div>
                </div>
                <Textarea
                  id="ep-prompt"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={10}
                  placeholder={DEFAULT_PROMPT_HINT}
                  className="font-mono text-[12px] leading-relaxed"
                />
                <p className="text-[10px] text-muted-foreground">
                  Pra voz, mantenha frases curtas (1-2 por resposta) — áudio longo cansa o cliente.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <div className="flex gap-2">
                  {(
                    [
                      { k: "active", label: "Ativo" },
                      { k: "draft", label: "Rascunho" },
                      { k: "retired", label: "Aposentado" },
                    ] as const
                  ).map((s) => (
                    <button
                      key={s.k}
                      type="button"
                      onClick={() => setStatus(s.k)}
                      className={cn(
                        "flex-1 rounded-md border px-3 py-1.5 text-[11px] transition-colors",
                        status === s.k
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-gray-200 dark:border-slate-800 hover:bg-muted",
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Zap className="h-3.5 w-3.5 text-primary" />
                    <span className="text-[12px] font-semibold text-primary">
                      ElevenLabs Conversational AI
                    </span>
                    {persona.elevenlabs_agent_id && (
                      <Badge className="bg-emerald-100 text-[9px] text-emerald-700">
                        sincronizado
                      </Badge>
                    )}
                  </div>
                  <Button
                    size="sm"
                    onClick={handleElSync}
                    disabled={syncing}
                    className="h-7 gap-1 bg-primary text-[11px] hover:bg-primary/90"
                  >
                    {syncing ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Zap className="h-3 w-3" />
                    )}
                    {persona.elevenlabs_agent_id ? "Re-sincronizar" : "Sincronizar com EL"}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  O ElevenLabs cuida de STT + LLM + TTS + RAG + tool calling integrados. Sincroniza
                  depois de editar prompt/voz pra refletir na voz.
                </p>
                {persona.elevenlabs_agent_id && (
                  <code className="block truncate rounded bg-muted px-1.5 py-0.5 text-[10px] text-primary">
                    {persona.elevenlabs_agent_id}
                  </code>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-gray-200 dark:border-slate-800 pt-3">
                <div className="text-[11px] text-muted-foreground">
                  Treinar destila o estilo de escrita a partir de mensagens reais do atendimento.
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleDistill}
                  disabled={distilling}
                  className="gap-1 text-[11px] text-primary hover:text-primary"
                >
                  {distilling ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  {persona.status === "active" ? "Re-treinar" : "Treinar"}
                </Button>
              </div>
            </div>
          )}

          {tab === "voice" && (
            <VoicePicker
              personaId={persona.id}
              accountId={accountId}
              currentVoiceId={persona.voice_clone_id}
              onSaved={() => onChanged()}
            />
          )}

          {tab === "knowledge" && (
            <KnowledgeTab
              persona={persona}
              accountId={accountId}
              kbTab={kbTab}
              setKbTab={setKbTab}
              kbName={kbName}
              setKbName={setKbName}
              kbUrl={kbUrl}
              setKbUrl={setKbUrl}
              kbText={kbText}
              setKbText={setKbText}
              addingKb={addingKb}
              setAddingKb={setAddingKb}
              onChanged={onChanged}
            />
          )}

          {tab === "advanced" && (
            <AdvancedTab
              firstMessage={firstMessage}
              setFirstMessage={setFirstMessage}
              turnTimeout={turnTimeout}
              setTurnTimeout={setTurnTimeout}
              turnEagerness={turnEagerness}
              setTurnEagerness={setTurnEagerness}
              ttsStability={ttsStability}
              setTtsStability={setTtsStability}
              ttsSpeed={ttsSpeed}
              setTtsSpeed={setTtsSpeed}
              ttsSimilarity={ttsSimilarity}
              setTtsSimilarity={setTtsSimilarity}
              asrKeywords={asrKeywords}
              setAsrKeywords={setAsrKeywords}
              llmTemperature={llmTemperature}
              setLlmTemperature={setLlmTemperature}
              llmMaxTokens={llmMaxTokens}
              setLlmMaxTokens={setLlmMaxTokens}
              llmModel={llmModel}
              setLlmModel={setLlmModel}
            />
          )}

          {tab === "channels" && (
            <PersonaDeploymentsPanel personaId={persona.id} accountId={accountId} />
          )}
        </div>

        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          <Button
            variant="ghost"
            onClick={handleDelete}
            className="text-rose-700 hover:bg-rose-50 hover:text-rose-700"
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Excluir
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Salvar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      {/* AI prompt generator sub-modal, rendered via Portal inside the main
          Dialog so closing only the sub-dialog doesn't dismiss the parent. */}
      <Dialog open={genOpen} onOpenChange={(v) => !v && setGenOpen(false)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-primary" />
              {systemPrompt ? "Refinar prompt com IA" : "Gerar prompt com IA"}
            </DialogTitle>
            <DialogDescription>
              Descreve em 1-2 frases o que a IA deve fazer. Vou expandir em um prompt completo
              otimizado pra voz.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div className="space-y-1.5">
              <Label className="text-[11px]">
                {systemPrompt ? "Mudanças / ideias adicionais" : "O que a IA faz?"}
              </Label>
              <Textarea
                value={genDescription}
                onChange={(e) => setGenDescription(e.target.value)}
                rows={3}
                placeholder={
                  systemPrompt
                    ? "Ex: adicionar perguntas de qualificação de orçamento, tom mais formal..."
                    : "Ex: atendente da ANÃO CHAVOSO (marca de roupa pra pessoas com nanismo), qualifica leads, tom descolado"
                }
                className="text-[12px]"
              />
            </div>

            {genResult && (
              <div className="space-y-1.5">
                <Label className="text-[11px]">Prompt gerado (preview)</Label>
                <div className="max-h-64 overflow-y-auto rounded-md border border-primary/40 bg-primary/5 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                  {genResult}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            {genResult ? (
              <>
                <Button variant="outline" onClick={() => setGenResult(null)}>
                  Re-gerar
                </Button>
                <Button onClick={handleUseGenerated}>
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  Usar esse prompt
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setGenOpen(false)} disabled={generating}>
                  Cancelar
                </Button>
                <Button onClick={handleGenerate} disabled={generating || !genDescription.trim()}>
                  {generating ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Gerar
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

/**
 * Knowledge base tab — add URL or text documents to the ElevenLabs agent.
 * Documents are created in EL, attached to the agent, and listed with
 * ability to remove.
 */
function KnowledgeTab({
  persona,
  accountId,
  kbTab,
  setKbTab,
  kbName,
  setKbName,
  kbUrl,
  setKbUrl,
  kbText,
  setKbText,
  addingKb,
  setAddingKb,
  onChanged,
}: {
  persona: Persona;
  accountId: string;
  kbTab: "url" | "text";
  setKbTab: (v: "url" | "text") => void;
  kbName: string;
  setKbName: (v: string) => void;
  kbUrl: string;
  setKbUrl: (v: string) => void;
  kbText: string;
  setKbText: (v: string) => void;
  addingKb: boolean;
  setAddingKb: (v: boolean) => void;
  onChanged: () => void;
}) {
  const hasAgent = !!persona.elevenlabs_agent_id;
  const kbIds = persona.elevenlabs_knowledge_base_ids ?? [];

  if (!hasAgent) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-center">
        <BookOpen className="mx-auto mb-2 h-5 w-5 text-amber-800" />
        <div className="text-[12px] font-medium text-amber-800">
          Sincronize o agente com ElevenLabs primeiro
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          Vai na aba Cérebro → Sincronizar com EL. A knowledge base só funciona em cima de um agent
          EL.
        </div>
      </div>
    );
  }

  const handleAdd = async () => {
    if (!kbName.trim()) {
      toast.error("Dê um nome pro documento");
      return;
    }
    setAddingKb(true);
    try {
      const { addKnowledgeBaseUrl, addKnowledgeBaseText } = await import("@/lib/personas");
      if (kbTab === "url") {
        if (!kbUrl.trim()) {
          toast.error("Cole a URL");
          return;
        }
        await addKnowledgeBaseUrl({
          accountId,
          personaId: persona.id,
          name: kbName.trim(),
          url: kbUrl.trim(),
        });
      } else {
        if (!kbText.trim()) {
          toast.error("Cole o conteúdo");
          return;
        }
        await addKnowledgeBaseText({
          accountId,
          personaId: persona.id,
          name: kbName.trim(),
          text: kbText.trim(),
        });
      }
      toast.success("Conhecimento adicionado");
      setKbName("");
      setKbUrl("");
      setKbText("");
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao adicionar");
    } finally {
      setAddingKb(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        Documentos que o agente consulta em tempo real durante a conversa (RAG). Suporta URL pública
        (site, FAQ), texto livre, ou PDF (via upload futuro). O agente escolhe automaticamente o que
        é relevante por pergunta.
      </p>

      <div className="rounded-md border border-gray-200 dark:border-slate-800 p-3">
        <div className="mb-2 flex rounded-md border border-gray-200 dark:border-slate-800 bg-background p-0.5">
          {(["url", "text"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setKbTab(t)}
              className={cn(
                "flex-1 rounded px-2 py-1 text-[11px] transition-colors",
                kbTab === t ? "bg-primary/10 text-primary" : "text-muted-foreground",
              )}
            >
              {t === "url" ? "URL" : "Texto livre"}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <Input
            value={kbName}
            onChange={(e) => setKbName(e.target.value)}
            placeholder="Nome (ex: FAQ 2026)"
            className="h-8 text-[12px]"
          />
          {kbTab === "url" ? (
            <Input
              value={kbUrl}
              onChange={(e) => setKbUrl(e.target.value)}
              placeholder="https://empresa.com.br/faq"
              className="h-8 text-[12px]"
            />
          ) : (
            <Textarea
              value={kbText}
              onChange={(e) => setKbText(e.target.value)}
              placeholder="Cole aqui textos de política, FAQ, catálogo..."
              rows={6}
              className="text-[12px]"
            />
          )}
          <Button size="sm" onClick={handleAdd} disabled={addingKb} className="w-full gap-1.5">
            {addingKb ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Adicionar conhecimento
          </Button>
        </div>
      </div>

      <div>
        <div className="mb-2 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
          Documentos anexados ({kbIds.length})
        </div>
        {kbIds.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Nenhum documento ainda. O agente só responde com base no system prompt.
          </p>
        ) : (
          <div className="space-y-1">
            {kbIds.map((id) => (
              <div
                key={id}
                className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1.5"
              >
                <code className="truncate text-[10px] text-muted-foreground">
                  {id.slice(0, 32)}…
                </code>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AdvancedTab(p: {
  firstMessage: string;
  setFirstMessage: (v: string) => void;
  turnTimeout: number;
  setTurnTimeout: (v: number) => void;
  turnEagerness: "eager" | "normal" | "cautious";
  setTurnEagerness: (v: "eager" | "normal" | "cautious") => void;
  ttsStability: number;
  setTtsStability: (v: number) => void;
  ttsSpeed: number;
  setTtsSpeed: (v: number) => void;
  ttsSimilarity: number;
  setTtsSimilarity: (v: number) => void;
  asrKeywords: string;
  setAsrKeywords: (v: string) => void;
  llmTemperature: number;
  setLlmTemperature: (v: number) => void;
  llmMaxTokens: number;
  setLlmMaxTokens: (v: number) => void;
  llmModel: string;
  setLlmModel: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Sliders className="h-3 w-3" />
        Ajustes que afetam latência, reconhecimento de fala e estilo da voz. Salve e re-sincronize
        com o EL pra aplicar na próxima ligação.
      </div>

      {/* First message */}
      <section className="space-y-1.5">
        <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Primeira mensagem
        </Label>
        <Input
          value={p.firstMessage}
          onChange={(e) => p.setFirstMessage(e.target.value)}
          placeholder="Oi! Aqui é a Nina da ANÃO CHAVOSO. Com quem eu tô falando?"
          className="text-[12px]"
        />
        <p className="text-[10px] text-muted-foreground">
          O que a IA fala assim que o cliente atende. Vazio = usa padrão automático.
        </p>
      </section>

      {/* Turn-taking */}
      <section className="space-y-2 rounded-md border border-gray-200 dark:border-slate-800 p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Turnos de fala
        </div>
        <div>
          <div className="flex items-center justify-between text-[11px]">
            <Label>
              Timeout de silêncio: <strong>{p.turnTimeout}s</strong>
            </Label>
            <span className="text-[10px] text-muted-foreground">rápido ↔ paciente</span>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={p.turnTimeout}
            onChange={(e) => p.setTurnTimeout(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <p className="text-[10px] text-muted-foreground">
            Segundos de silêncio antes da IA assumir que é sua vez de falar. Menor = responde mais
            rápido, mas pode cortar o cliente.
          </p>
        </div>
        <div>
          <Label className="text-[11px]">Agressividade de resposta</Label>
          <div className="mt-1 flex gap-2">
            {(["eager", "normal", "cautious"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => p.setTurnEagerness(v)}
                className={cn(
                  "flex-1 rounded-md border px-2 py-1 text-[11px] transition-colors",
                  p.turnEagerness === v
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-gray-200 dark:border-slate-800 hover:bg-muted",
                )}
              >
                {v === "eager" ? "Ágil" : v === "normal" ? "Normal" : "Paciente"}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* TTS */}
      <section className="space-y-2 rounded-md border border-gray-200 dark:border-slate-800 p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Voz (TTS ElevenLabs)
        </div>
        <div>
          <Label className="text-[11px]">
            Estabilidade: <strong>{p.ttsStability.toFixed(2)}</strong>
          </Label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={p.ttsStability}
            onChange={(e) => p.setTtsStability(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <p className="text-[10px] text-muted-foreground">
            Baixo = mais expressivo (emoção), alto = mais previsível. 0.3-0.5 é o sweet spot pra
            voz.
          </p>
        </div>
        <div>
          <Label className="text-[11px]">
            Velocidade: <strong>{p.ttsSpeed.toFixed(2)}x</strong>
          </Label>
          <input
            type="range"
            min={0.7}
            max={1.3}
            step={0.05}
            value={p.ttsSpeed}
            onChange={(e) => p.setTtsSpeed(Number(e.target.value))}
            className="w-full accent-primary"
          />
        </div>
        <div>
          <Label className="text-[11px]">
            Similaridade com original: <strong>{p.ttsSimilarity.toFixed(2)}</strong>
          </Label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={p.ttsSimilarity}
            onChange={(e) => p.setTtsSimilarity(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <p className="text-[10px] text-muted-foreground">
            Alto = mais fiel à voz base (recomendado pra vozes clonadas).
          </p>
        </div>
      </section>

      {/* ASR keywords */}
      <section className="space-y-1.5 rounded-md border border-gray-200 dark:border-slate-800 p-3">
        <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Palavras-chave do negócio (STT)
        </Label>
        <Input
          value={p.asrKeywords}
          onChange={(e) => p.setAsrKeywords(e.target.value)}
          placeholder="Ex: ANÃO CHAVOSO, NX-P, NX-M, chavoso, nanismo"
          className="text-[12px]"
        />
        <p className="text-[10px] text-muted-foreground">
          Separado por vírgulas. Termos técnicos, nomes de marca e SKUs — ajuda o reconhecimento de
          fala não confundir com palavras parecidas.
        </p>
      </section>

      {/* LLM */}
      <section className="space-y-2 rounded-md border border-gray-200 dark:border-slate-800 p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Cérebro (LLM)
        </div>
        <div>
          <Label className="text-[11px]">Modelo</Label>
          <Select value={p.llmModel} onValueChange={p.setLlmModel}>
            <SelectTrigger className="mt-1 h-8 w-full bg-background text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash (rápido, barato, pt-BR bom)</SelectItem>
              <SelectItem value="gpt-4o-mini">GPT-4o Mini (consistente)</SelectItem>
              <SelectItem value="gpt-4o">GPT-4o (melhor qualidade, caro)</SelectItem>
              <SelectItem value="claude-haiku-4-5">Claude Haiku 4.5 (rápido, nuance)</SelectItem>
              <SelectItem value="claude-sonnet-4-5">Claude Sonnet 4.5 (raciocínio)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[11px]">
            Temperatura: <strong>{p.llmTemperature.toFixed(2)}</strong>
          </Label>
          <input
            type="range"
            min={0}
            max={1.2}
            step={0.1}
            value={p.llmTemperature}
            onChange={(e) => p.setLlmTemperature(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <p className="text-[10px] text-muted-foreground">
            0 = determinístico, 1 = criativo. Pra atendimento, 0.4-0.7 é bom.
          </p>
        </div>
        <div>
          <Label className="text-[11px]">
            Máximo de tokens por resposta: <strong>{p.llmMaxTokens}</strong>
          </Label>
          <input
            type="range"
            min={50}
            max={500}
            step={10}
            value={p.llmMaxTokens}
            onChange={(e) => p.setLlmMaxTokens(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <p className="text-[10px] text-muted-foreground">
            Mais baixo = respostas curtas (recomendado pra voz). 120-180 é ideal.
          </p>
        </div>
      </section>
    </div>
  );
}

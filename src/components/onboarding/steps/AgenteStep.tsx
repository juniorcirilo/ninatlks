import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { syncElevenLabsAgent } from "@/lib/personas";
import type { OnboardingState } from "@/lib/onboarding";

interface VoiceOption {
  voice_id: string;
  name: string;
  language?: string;
  preview_url?: string;
}

const DEFAULT_PROMPT = `Você é um atendente cordial e direto. Responda em português do Brasil de forma curta e natural (1-2 frases). Se não souber algo, ofereça transferir para um humano. Nunca invente preços ou prazos.`;

export function AgenteStep({
  accountId,
  state,
  onCreated,
}: {
  accountId: string;
  state: OnboardingState | null;
  onCreated: (info: { personaId: string; synced: boolean; syncError?: string }) => void;
}) {
  const { user } = useAuth();
  const saved = (state?.metadata?.agente ?? {}) as Record<string, any>;
  const [name, setName] = useState<string>(saved.name ?? "Atendente Virtual");
  const [prompt, setPrompt] = useState<string>(saved.prompt ?? DEFAULT_PROMPT);
  const [voiceId, setVoiceId] = useState<string>(saved.voice_id ?? "");

  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(true);
  const [voicesError, setVoicesError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [createdPersonaId, setCreatedPersonaId] = useState<string | null>(saved.persona_id ?? null);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "ok" | "error">("idle");
  const [syncError, setSyncError] = useState<string | null>(null);

  // Detect ElevenLabs status from cached health check
  const elStatus = useMemo(() => {
    const providers = (state?.health_check_results as any)?.providers as any[] | undefined;
    const el = providers?.find((p) => p.key === "elevenlabs");
    if (!el) return "unknown" as const;
    if (!el.configured) return "missing" as const;
    if (el.ok === false) return "invalid" as const;
    return "ok" as const;
  }, [state]);

  useEffect(() => {
    // Só pede vozes se a key da ElevenLabs estiver realmente OK.
    // Sem isso, o Edge Function retorna 401 e mostra um toast feio.
    if (elStatus !== "ok") {
      setVoices([]);
      setLoadingVoices(false);
      return;
    }

    let cancelled = false;
    setLoadingVoices(true);
    supabase.functions
      .invoke("elevenlabs-voices", { method: "GET" } as any)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setVoicesError(error.message);
          setLoadingVoices(false);
          return;
        }
        const list = ((data as any)?.voices ?? []) as any[];
        const ptVoices: VoiceOption[] = list
          .filter((v) => {
            const lang = (v?.fine_tuning?.language ?? v?.labels?.language ?? "").toString().toLowerCase();
            return lang.includes("pt") || lang.includes("portuguese") || lang.includes("multi") || !lang;
          })
          .map((v) => ({
            voice_id: v.voice_id,
            name: v.name,
            language: v?.fine_tuning?.language ?? v?.labels?.language,
            preview_url: v?.preview_url,
          }));
        setVoices(ptVoices);
        if (!voiceId && ptVoices.length > 0) setVoiceId(ptVoices[0].voice_id);
        setLoadingVoices(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, elStatus]);

  const createAgent = async () => {
    if (!name.trim() || !prompt.trim()) return;
    setCreating(true);
    setSyncError(null);
    try {
      const { data, error } = await supabase
        .from("agent_personas")
        .insert({
          account_id: accountId,
          source_user_id: user?.id ?? null,
          name: name.trim(),
          description: "Criado no onboarding",
          system_prompt: prompt.trim(),
          voice_provider: voiceId ? "elevenlabs" : null,
          voice_clone_id: voiceId || null,
          status: "active",
        } as any)
        .select("id")
        .single();
      if (error) throw error;
      const personaId = (data as any).id as string;
      setCreatedPersonaId(personaId);

      if (elStatus === "ok") {
        setSyncStatus("syncing");
        try {
          await syncElevenLabsAgent(personaId);
          setSyncStatus("ok");
          onCreated({ personaId, synced: true });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Falha no sync";
          setSyncStatus("error");
          setSyncError(msg);
          onCreated({ personaId, synced: false, syncError: msg });
        }
      } else {
        setSyncStatus("idle");
        onCreated({ personaId, synced: false });
      }
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Falha ao criar agente");
    } finally {
      setCreating(false);
    }
  };

  const retrySync = async () => {
    if (!createdPersonaId) return;
    setSyncStatus("syncing");
    setSyncError(null);
    try {
      await syncElevenLabsAgent(createdPersonaId);
      setSyncStatus("ok");
      onCreated({ personaId: createdPersonaId, synced: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha no sync";
      setSyncStatus("error");
      setSyncError(msg);
    }
  };

  const persistedPayload = createdPersonaId
    ? { persona_id: createdPersonaId, name, prompt, voice_id: voiceId }
    : null;

  // Communicate the payload up so the wizard can persist on advance.
  useEffect(() => {
    if (createdPersonaId) {
      // expose via dataset so wizard can pick up; simpler: rely on onCreated above
    }
  }, [createdPersonaId, persistedPayload]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Primeiro agente IA</h2>
        <p className="text-sm text-muted-foreground">
          Define como a IA vai falar com seus clientes. Você pode editar tudo
          depois em <code>/agents</code>.
        </p>
      </div>

      {elStatus === "missing" && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-[12px] text-amber-900">
          ⚠ ElevenLabs não está configurado. Vamos criar a persona local — quando
          você adicionar a key, é só voltar e clicar em "Sincronizar".
        </div>
      )}
      {elStatus === "invalid" && (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-[12px] text-rose-800">
          ✗ ElevenLabs com erro. A persona será criada local; sync vai falhar até a key ser corrigida.
        </div>
      )}

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="agent-name">Nome do agente *</Label>
          <Input
            id="agent-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Ana — Atendimento"
            disabled={!!createdPersonaId}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="agent-prompt">Como a IA deve responder *</Label>
          <Textarea
            id="agent-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={6}
            disabled={!!createdPersonaId}
            className="font-mono text-[12px]"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="agent-voice">Voz (opcional)</Label>
          {loadingVoices ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Carregando vozes…
            </div>
          ) : voicesError ? (
            <p className="text-[12px] text-amber-700">
              Não conseguimos carregar vozes ({voicesError}). Você pode escolher depois.
            </p>
          ) : voices.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              Nenhuma voz disponível. Vai usar a voz padrão da ElevenLabs.
            </p>
          ) : (
            <Select value={voiceId} onValueChange={setVoiceId} disabled={!!createdPersonaId}>
              <SelectTrigger id="agent-voice">
                <SelectValue placeholder="Selecione uma voz" />
              </SelectTrigger>
              <SelectContent>
                {voices.map((v) => (
                  <SelectItem key={v.voice_id} value={v.voice_id}>
                    {v.name}
                    {v.language ? <span className="ml-1.5 text-[10px] text-muted-foreground">({v.language})</span> : null}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {!createdPersonaId ? (
        <Button
          onClick={createAgent}
          disabled={creating || !name.trim() || !prompt.trim()}
          className="w-full"
        >
          {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Criar agente
        </Button>
      ) : (
        <div className="rounded-md border border-emerald-300 bg-emerald-100 p-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            Agente criado
          </div>
          <div className="mt-1 text-[12px] text-muted-foreground">
            {syncStatus === "syncing" && "Sincronizando com ElevenLabs…"}
            {syncStatus === "ok" && "✓ Sincronizado com ElevenLabs (pronto pra ligar)."}
            {syncStatus === "idle" && "Persona local criada. Sync vai rodar quando configurar a key."}
            {syncStatus === "error" && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-rose-700">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Sync falhou: {syncError}
                </div>
                <Button size="sm" variant="outline" onClick={retrySync}>
                  Tentar de novo
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

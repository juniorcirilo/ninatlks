import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Play, Pause, Volume2, Check, Upload, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { fetchVoicesAndQuota, previewVoice, type ElevenLabsVoice } from "@/lib/elevenlabs";
import { updatePersona } from "@/lib/personas";
import { cloneVoiceForPersona } from "@/lib/voice";

const PREVIEW_TEXT_DEFAULT = "Olá, sou a Nina. Como posso te ajudar hoje?";

export function VoicePicker({
  personaId,
  accountId,
  currentVoiceId,
  onSaved,
}: {
  personaId: string;
  accountId: string;
  currentVoiceId: string | null;
  onSaved?: (voiceId: string) => void;
}) {
  const [voices, setVoices] = useState<ElevenLabsVoice[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "pt-BR" | "multilingual">("pt-BR");
  const [search, setSearch] = useState("");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState(PREVIEW_TEXT_DEFAULT);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Voice cloning upload state.
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [cloning, setCloning] = useState(false);
  const [cloneProgress, setCloneProgress] = useState<string | null>(null);
  const cloneInputRef = useRef<HTMLInputElement | null>(null);

  const reloadVoices = async () => {
    try {
      const { voices: vs } = await fetchVoicesAndQuota(accountId);
      setVoices(vs);
    } catch {
      /* ignore */
    }
  };

  const handleClone = async () => {
    if (!cloneFile) return;
    if (cloneFile.size < 100_000) {
      toast.error("Áudio muito curto. Envie pelo menos ~30 segundos (MP3/WAV).");
      return;
    }
    if (cloneFile.size > 25_000_000) {
      toast.error("Arquivo muito grande. Máximo 25MB.");
      return;
    }
    setCloning(true);
    setCloneProgress("Fazendo upload e criando voz no ElevenLabs…");
    try {
      const result = await cloneVoiceForPersona({
        accountId,
        personaId,
        file: cloneFile,
      });
      toast.success("Voz clonada e vinculada ao agente");
      setCloneFile(null);
      setCloneProgress(null);
      if (cloneInputRef.current) cloneInputRef.current.value = "";
      await reloadVoices();
      onSaved?.(result.voiceId);
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao clonar voz");
    } finally {
      setCloning(false);
      setCloneProgress(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { voices } = await fetchVoicesAndQuota(accountId);
        if (!cancelled) setVoices(voices);
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? "Não foi possível carregar vozes");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredVoices = useMemo(() => {
    if (!voices) return [];
    const q = search.trim().toLowerCase();
    return voices.filter((v) => {
      if (q && !v.name.toLowerCase().includes(q)) return false;
      if (filter === "pt-BR") {
        const lang = (v.labels?.language ?? "").toLowerCase();
        const accent = (v.labels?.accent ?? "").toLowerCase();
        const desc = (v.description ?? "").toLowerCase();
        const anyV = v as any;
        const verified: any[] = Array.isArray(anyV.verified_languages)
          ? anyV.verified_languages
          : [];
        const baseModels: string[] = Array.isArray(anyV.high_quality_base_model_ids)
          ? anyV.high_quality_base_model_ids
          : [];
        const isPt =
          lang.includes("portuguese") ||
          accent.includes("brazil") ||
          verified.some((vl) =>
            String(vl?.language ?? "")
              .toLowerCase()
              .startsWith("pt"),
          );
        const isMulti =
          lang.includes("multi") ||
          desc.includes("multilingual") ||
          baseModels.some((m) => m.includes("multilingual"));
        if (!isPt && !isMulti) return false;
      } else if (filter === "multilingual") {
        const anyV = v as any;
        const lang = (v.labels?.language ?? "").toLowerCase();
        const baseModels: string[] = Array.isArray(anyV.high_quality_base_model_ids)
          ? anyV.high_quality_base_model_ids
          : [];
        if (!lang.includes("multi") && !baseModels.some((m) => m.includes("multilingual")))
          return false;
      }
      return true;
    });
  }, [voices, filter, search]);

  const play = useCallback(
    async (voice: ElevenLabsVoice) => {
      // If clicking the same voice that's playing, pause.
      if (playingId === voice.voice_id && audioRef.current) {
        audioRef.current.pause();
        setPlayingId(null);
        return;
      }
      audioRef.current?.pause();
      setPlayingId(voice.voice_id);
      try {
        // Use the TTS endpoint so preview uses the exact ElevenLabs voice
        // configured for the persona (including multilingual quality), not
        // the old static preview_url which is English-only.
        const blob = await previewVoice(accountId, {
          voiceId: voice.voice_id,
          text: previewText,
          languageCode: "pt",
        });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          setPlayingId((cur) => (cur === voice.voice_id ? null : cur));
          URL.revokeObjectURL(url);
        };
        audio.onerror = () => {
          setPlayingId(null);
          URL.revokeObjectURL(url);
          toast.error("Falha ao reproduzir preview");
        };
        await audio.play();
      } catch (e: any) {
        setPlayingId(null);
        toast.error(e?.message ?? "Erro no preview");
      }
    },
    [playingId, previewText],
  );

  const save = async (voice: ElevenLabsVoice) => {
    setSaving(voice.voice_id);
    try {
      await updatePersona(accountId, personaId, {
        voice_provider: "elevenlabs",
        voice_clone_id: voice.voice_id,
      });
      toast.success(`Voz "${voice.name}" vinculada ao agente`);
      onSaved?.(voice.voice_id);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar voz");
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Carregando vozes do ElevenLabs…
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-[11px] text-rose-700">
        {error}. Verifique <code>ELEVENLABS_API_KEY</code> em Cloud Secrets.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Voice cloning upload */}
      <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-primary">
          <Sparkles className="h-3.5 w-3.5" />
          Clonar minha voz
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          Envie 30s a 5min de áudio limpo (MP3 ou WAV, sem música de fundo). O ElevenLabs cria uma
          voz personalizada e vincula automaticamente ao agente.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            ref={cloneInputRef}
            type="file"
            accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp3,.mp3,.wav"
            onChange={(e) => setCloneFile(e.target.files?.[0] ?? null)}
            className="hidden"
            id="voice-clone-file"
          />
          <label
            htmlFor="voice-clone-file"
            className="flex cursor-pointer items-center gap-1 rounded-md border border-gray-200 dark:border-slate-800 bg-background px-2 py-1 text-[11px] hover:bg-muted"
          >
            <Upload className="h-3 w-3" />
            {cloneFile ? cloneFile.name : "Escolher áudio"}
          </label>
          {cloneFile && (
            <>
              <span className="text-[10px] text-muted-foreground">
                {(cloneFile.size / 1024 / 1024).toFixed(1)} MB
              </span>
              <Button
                size="sm"
                onClick={handleClone}
                disabled={cloning}
                className="h-7 px-2 text-[11px]"
              >
                {cloning ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                Clonar
              </Button>
            </>
          )}
        </div>
        {cloneProgress && <p className="mt-1.5 text-[10px] text-primary">{cloneProgress}</p>}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex rounded-md border border-gray-200 dark:border-slate-800 bg-background p-0.5">
          {(["pt-BR", "multilingual", "all"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded px-2 py-0.5 text-[10px]",
                filter === f
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f === "pt-BR" ? "pt-BR" : f === "multilingual" ? "Multi" : "Todas"}
            </button>
          ))}
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar voz…"
          className="h-7 flex-1 text-[11px]"
        />
      </div>

      <Input
        value={previewText}
        onChange={(e) => setPreviewText(e.target.value)}
        placeholder="Texto pra testar"
        className="h-7 text-[11px]"
      />

      <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
        {filteredVoices.length === 0 && (
          <p className="text-[11px] text-muted-foreground">
            Nenhuma voz {filter === "pt-BR" ? "em pt-BR" : "multilíngue"} no seu workspace. Mude o
            filtro ou adicione uma nova em elevenlabs.io.
          </p>
        )}
        {filteredVoices.map((v) => {
          const isCurrent = currentVoiceId === v.voice_id;
          const isPlaying = playingId === v.voice_id;
          const isSaving = saving === v.voice_id;
          return (
            <div
              key={v.voice_id}
              className={cn(
                "flex items-center gap-2 rounded-md border p-2",
                isCurrent ? "border-primary/40 bg-primary/5" : "border-gray-200 dark:border-slate-800 hover:bg-muted",
              )}
            >
              <button
                type="button"
                onClick={() => play(v)}
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors",
                  isPlaying
                    ? "bg-primary text-white"
                    : "bg-muted text-muted-foreground hover:bg-muted",
                )}
                aria-label={isPlaying ? "Pausar" : "Tocar preview"}
              >
                {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[12px] font-medium">{v.name}</span>
                  {v.category === "cloned" && (
                    <span className="rounded bg-primary/10 px-1 text-[9px] text-primary">
                      clone
                    </span>
                  )}
                </div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {v.labels?.accent ?? v.labels?.language ?? v.category ?? "—"}
                </div>
              </div>
              {isCurrent ? (
                <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
                  <Check className="h-3 w-3" />
                  atual
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => save(v)}
                  disabled={isSaving}
                  className="h-6 px-2 text-[10px]"
                >
                  {isSaving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Volume2 className="h-3 w-3" />
                  )}
                  Usar
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

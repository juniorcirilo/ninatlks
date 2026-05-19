import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import {
  Bot, Plus, Loader2, Mic, MessageSquare, BookOpen, CheckCircle2, AlertCircle,
  ExternalLink, Languages,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useAccount } from "@/lib/account-context";
import { fetchPersonas, createPersona, type Persona } from "@/lib/personas";
import { AgentEditor } from "@/components/personas/AgentEditor";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type AgentInfo = {
  found: boolean;
  language?: string | null;
  voice_id?: string | null;
  model_id?: string | null;
};

const LANG_LABELS: Record<string, { label: string; flag: string }> = {
  pt: { label: "Português (BR)", flag: "🇧🇷" },
  "pt-br": { label: "Português (BR)", flag: "🇧🇷" },
  "pt-pt": { label: "Português (PT)", flag: "🇵🇹" },
  en: { label: "English", flag: "🇺🇸" },
  "en-us": { label: "English (US)", flag: "🇺🇸" },
  "en-gb": { label: "English (UK)", flag: "🇬🇧" },
  es: { label: "Español", flag: "🇪🇸" },
  fr: { label: "Français", flag: "🇫🇷" },
  de: { label: "Deutsch", flag: "🇩🇪" },
  it: { label: "Italiano", flag: "🇮🇹" },
};

function langDisplay(code?: string | null): { label: string; flag: string; isPt: boolean } {
  if (!code) return { label: "Idioma não definido", flag: "🌐", isPt: false };
  const key = code.toLowerCase();
  const found = LANG_LABELS[key] ?? LANG_LABELS[key.split("-")[0]];
  const isPt = key.startsWith("pt");
  return found ? { ...found, isPt } : { label: code.toUpperCase(), flag: "🌐", isPt };
}


export const Route = createFileRoute("/_authenticated/agents")({
  head: () => ({
    meta: [
      { title: "Agentes de voz — Nina Talks" },
      { name: "description", content: "Configure agentes conversacionais ElevenLabs especializados em SDR." },
    ],
  }),
  component: AgentsPage,
});

function AgentsPage() {
  const { accountId } = useAccount();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Persona | null>(null);
  const [agentInfo, setAgentInfo] = useState<Record<string, AgentInfo>>({});

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const list = await fetchPersonas(accountId);
      setPersonas(list);
    } catch (e) {
      console.error("[agents] load failed", e);
      toast.error("Não conseguimos carregar os agentes.");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => { load(); }, [load]);

  // Busca config real (idioma/voz) de cada agente sincronizado direto da ElevenLabs.
  useEffect(() => {
    let cancelled = false;
    const synced = personas.filter((p) => p.elevenlabs_agent_id);
    if (synced.length === 0) return;

    (async () => {
      const sess = await supabase.auth.getSession();
      const token = sess.data.session?.access_token;
      if (!token) return;
      const base = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-agent-info`;
      const apikey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
      const results = await Promise.all(
        synced.map(async (p) => {
          try {
            const res = await fetch(`${base}?agent_id=${encodeURIComponent(p.elevenlabs_agent_id!)}`, {
              headers: { Authorization: `Bearer ${token}`, apikey },
            });
            if (!res.ok) return [p.id, { found: false }] as const;
            const data = (await res.json()) as AgentInfo;
            return [p.id, data] as const;
          } catch {
            return [p.id, { found: false }] as const;
          }
        }),
      );
      if (cancelled) return;
      setAgentInfo(Object.fromEntries(results));
    })();

    return () => { cancelled = true; };
  }, [personas]);



  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="SDR"
        title="Agentes de voz"
        description="Configure agentes ElevenLabs especializados em SDR: prompt, voz, modelo, comportamento e base de conhecimento."
        actions={
          <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Novo agente
          </Button>
        }
      />

      <div className="px-6 py-6">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : personas.length === 0 ? (
          <EmptyState
            icon={Bot}
            title="Nenhum agente configurado"
            description="Crie seu primeiro agente de voz. Já vem com prompt de SDR pronto (qualificação BANT, agendamento por tool, briefing automático)."
            action={
              <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
                <Plus className="h-4 w-4" />
                Criar primeiro agente
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {personas.map((p) => (
              <AgentCard
                key={p.id}
                persona={p}
                info={p.elevenlabs_agent_id ? agentInfo[p.id] : undefined}
                onClick={() => setEditing(p)}
              />
            ))}
          </div>
        )}
      </div>

      <CreateAgentDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        accountId={accountId}
        onCreated={(p) => {
          setCreateOpen(false);
          load();
          if (p) setEditing(p);
        }}
      />

      <AgentEditor
        open={Boolean(editing)}
        persona={editing}
        accountId={accountId ?? ""}
        onClose={() => setEditing(null)}
        onSaved={() => { load(); }}
      />
    </div>
  );
}

function AgentCard({
  persona,
  info,
  onClick,
}: {
  persona: Persona;
  info?: AgentInfo;
  onClick: () => void;
}) {
  const hasPrompt = Boolean(persona.system_prompt && persona.system_prompt.trim());
  const hasVoice = Boolean(persona.voice_clone_id);
  const hasKB = (persona.elevenlabs_knowledge_base_ids ?? []).length > 0;
  const synced = Boolean(persona.elevenlabs_agent_id);
  const elAgentUrl = persona.elevenlabs_agent_id
    ? `https://elevenlabs.io/app/conversational-ai/agents/${persona.elevenlabs_agent_id}`
    : null;
  const lang = langDisplay(info?.language);

  return (
    <div className="group relative flex flex-col gap-3 rounded-xl border border-border bg-muted/40 p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted">
      <button
        type="button"
        onClick={onClick}
        className="absolute inset-0 rounded-xl"
        aria-label={`Configurar ${persona.name}`}
      />
      <div className="relative flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500">
            <Bot className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{persona.name}</h3>
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              {synced ? (
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <CheckCircle2 className="h-2.5 w-2.5" />
                  Sincronizado
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-amber-800">
                  <AlertCircle className="h-2.5 w-2.5" />
                  Não sincronizado
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {persona.description && (
        <p className="relative line-clamp-2 text-[11px] text-muted-foreground">{persona.description}</p>
      )}

      <div className="relative flex flex-wrap items-center gap-1.5">
        <CapBadge active={hasPrompt} icon={MessageSquare} label="prompt" />
        <CapBadge active={hasVoice} icon={Mic} label="voz" />
        <CapBadge active={hasKB} icon={BookOpen} label="RAG" />
      </div>

      {synced && (
        <div className="relative flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/60 px-2 py-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            {info === undefined ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">Lendo config da ElevenLabs…</span>
              </>
            ) : info.found === false ? (
              <>
                <AlertCircle className="h-3 w-3 text-rose-600" />
                <span className="text-[10px] text-rose-700">Não encontrado na ElevenLabs</span>
              </>
            ) : (
              <>
                <Languages className={cn("h-3 w-3", lang.isPt ? "text-emerald-700" : "text-amber-700")} />
                <span className="text-[11px] font-medium leading-none">
                  <span className="mr-1">{lang.flag}</span>
                  {lang.label}
                </span>
                {!lang.isPt && info.language && (
                  <span className="text-[10px] text-amber-700">(não é PT-BR)</span>
                )}
              </>
            )}
          </div>
          {elAgentUrl && (
            <a
              href={elAgentUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="relative z-10 inline-flex items-center gap-1 rounded text-[10px] text-primary hover:underline"
              title="Abrir no painel ElevenLabs"
            >
              ElevenLabs
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}

      <div className="relative text-[10px] text-primary opacity-0 transition-opacity group-hover:opacity-100">
        Clique para configurar →
      </div>
    </div>
  );
}

function CapBadge({
  active,
  icon: Icon,
  label,
}: {
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px]",
        active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

function CreateAgentDialog({
  open,
  onClose,
  onCreated,
  accountId,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (created: Persona | null) => void;
  accountId: string | null;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  // Reset form when reopened
  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setCreating(false);
    }
  }, [open]);

  const handleCreate = async () => {
    if (creating || !name.trim() || !accountId) return;
    setCreating(true);
    try {
      const created = await createPersona({
        accountId,
        name: name.trim(),
        description: description.trim() || undefined,
      });
      toast.success("Agente criado — agora configure o prompt e a voz");
      onCreated(created);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erro desconhecido";
      console.error("[agents] create failed", e);
      toast.error(`Falha ao criar agente: ${msg.slice(0, 200)}`);
      onCreated(null);
    } finally {
      setCreating(false);
    }
  };

  const canSubmit = Boolean(name.trim() && accountId && !creating);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            Novo agente de voz
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            Crie o agente. No próximo passo você configura prompt, voz, modelo e
            base de conhecimento.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => { e.preventDefault(); handleCreate(); }}
          className="space-y-3"
        >
          <div>
            <label htmlFor="agent-name" className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Nome
            </label>
            <Input
              id="agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Nina (SDR inbound)"
              className="mt-1"
              autoFocus
              disabled={creating}
            />
          </div>
          <div>
            <label htmlFor="agent-desc" className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Descrição (opcional)
            </label>
            <Textarea
              id="agent-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex: Cobrança de boletos vencidos até 30 dias, tom amigável."
              className="mt-1"
              rows={3}
              disabled={creating}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={creating}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {creating ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="mr-1.5 h-3.5 w-3.5" />
              )}
              Criar e configurar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

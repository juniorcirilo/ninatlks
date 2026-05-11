import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import {
  Bot, Plus, Loader2, Mic, MessageSquare, BookOpen, CheckCircle2, AlertCircle,
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
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
              <AgentCard key={p.id} persona={p} onClick={() => setEditing(p)} />
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

function AgentCard({ persona, onClick }: { persona: Persona; onClick: () => void }) {
  const hasPrompt = Boolean(persona.system_prompt && persona.system_prompt.trim());
  const hasVoice = Boolean(persona.voice_clone_id);
  const hasKB = (persona.elevenlabs_knowledge_base_ids ?? []).length > 0;
  const synced = Boolean(persona.elevenlabs_agent_id);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col gap-3 rounded-xl border border-border bg-muted/40 p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted"
    >
      <div className="flex items-start justify-between gap-2">
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
        <p className="line-clamp-2 text-[11px] text-muted-foreground">{persona.description}</p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <CapBadge active={hasPrompt} icon={MessageSquare} label="prompt" />
        <CapBadge active={hasVoice} icon={Mic} label="voz" />
        <CapBadge active={hasKB} icon={BookOpen} label="RAG" />
      </div>

      <div className="text-[10px] text-primary opacity-0 transition-opacity group-hover:opacity-100">
        Clique para configurar →
      </div>
    </button>
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

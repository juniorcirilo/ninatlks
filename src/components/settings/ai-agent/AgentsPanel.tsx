// Aba "Agentes": os agentes do sistema (os mesmos de /agents) e, para cada um,
// suas skills e skills-tool (ferramentas de acesso a banco).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bot, Loader2, Plus, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { fetchPersonas, STATUS_LABELS } from "@/lib/personas";
import {
  updateAiSkill,
  type AiAgentOverview,
  type AiAgentSkill,
  type AiAgentTool,
} from "@/lib/ai-agent";
import { errMsg } from "./shared";
import { SkillDialog } from "./SkillDialog";
import { SkillGenerationDialog } from "./SkillGenerationDialog";
import { ToolDialog } from "./ToolDialog";
import { ToolsSection } from "./ToolsSection";

export function AgentsPanel({
  accountId,
  data,
  onChanged,
  onOpenIntegrations,
}: {
  accountId: string;
  data: AiAgentOverview;
  onChanged: () => void;
  onOpenIntegrations?: () => void;
}) {
  const { data: personas = [], isLoading } = useQuery({
    queryKey: ["personas", accountId],
    queryFn: () => fetchPersonas(accountId),
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [skill, setSkill] = useState<AiAgentSkill | "new" | null>(null);
  const [tool, setTool] = useState<AiAgentTool | "new" | null>(null);
  const [generatingFor, setGeneratingFor] = useState<{
    name: string;
    description: string;
    personaId: string;
  } | null>(null);
  const [query, setQuery] = useState("");

  if (isLoading)
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );

  if (personas.length === 0)
    return (
      <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        Nenhum agente criado ainda.{" "}
        <Link to="/agents" className="font-medium text-primary underline-offset-2 hover:underline">
          Crie um em Agentes de voz
        </Link>{" "}
        — a skill dele é gerada pelo IA Agent a partir da descrição.
      </div>
    );

  const selected = personas.find((p) => p.id === selectedId) ?? personas[0];
  const q = query.trim().toLowerCase();
  const visible = q ? personas.filter((p) => p.name.toLowerCase().includes(q)) : personas;
  const skills = data.skills.filter((s) => s.persona_id === selected.id);
  const tools = data.tools.filter((t) => t.persona_id === selected.id);
  const counts = (id: string) => ({
    skills: data.skills.filter((s) => s.persona_id === id).length,
    tools: data.tools.filter((t) => t.persona_id === id).length,
  });
  const canGenerate = (selected.description ?? "").trim().length >= 3;
  const generating = generatingFor?.personaId === selected.id;
  const hasGeneratedSkill = skills.some((s) => s.origin === "generated");

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_1fr] lg:items-start">
      <aside className="flex max-h-72 flex-col overflow-hidden rounded-xl border bg-card lg:sticky lg:top-4 lg:max-h-[calc(100vh-10rem)]">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">
            Agentes <span className="font-normal text-muted-foreground">({personas.length})</span>
          </h3>
          <Link to="/agents" className="text-xs text-primary underline-offset-2 hover:underline">
            Gerenciar
          </Link>
        </div>
        {personas.length > 5 && (
          <div className="relative border-b p-2">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar agente"
              aria-label="Buscar agente"
              className="h-8 pl-8 text-sm"
            />
          </div>
        )}
        <nav aria-label="Agentes do sistema" className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {visible.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              Nenhum agente encontrado.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {visible.map((p) => {
                const c = counts(p.id);
                const active = p.id === selected.id;
                const live = p.status === "active" && p.enabled;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent",
                        active && "bg-accent",
                      )}
                    >
                      {active && (
                        <span
                          className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary"
                          aria-hidden="true"
                        />
                      )}
                      <span
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                          active ? "bg-primary text-primary-foreground" : "bg-muted text-primary",
                        )}
                        aria-hidden="true"
                      >
                        <Bot className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{p.name}</span>
                          <span
                            className={cn(
                              "h-1.5 w-1.5 shrink-0 rounded-full",
                              live ? "bg-emerald-500" : "bg-muted-foreground/50",
                            )}
                            aria-hidden="true"
                          />
                          <span className="sr-only">
                            {STATUS_LABELS[p.status] ?? p.status}
                            {p.enabled ? "" : ", desativado"}
                          </span>
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {c.skills} skill{c.skills === 1 ? "" : "s"} · {c.tools} ferramenta
                          {c.tools === 1 ? "" : "s"}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>
      </aside>

      <div className="min-w-0 space-y-8">
        <div>
          <h3 className="text-lg font-semibold">{selected.name}</h3>
          <p className="text-sm text-muted-foreground">
            {selected.description?.trim() || "Sem descrição. Edite o agente em Agentes de voz."}
          </p>
        </div>

        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold">Skills deste agente</h3>
              <p className="text-sm text-muted-foreground">
                Instruções que só este agente usa, além das skills gerais.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={generating || !canGenerate}
                title={
                  !canGenerate
                    ? "Adicione uma descrição ao agente para gerar a skill"
                    : hasGeneratedSkill
                      ? "Substitui o conteúdo da skill gerada anteriormente para este agente"
                      : undefined
                }
                onClick={() =>
                  setGeneratingFor({
                    name: selected.name,
                    description: (selected.description ?? "").trim(),
                    personaId: selected.id,
                  })
                }
              >
                {generating ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-1 h-4 w-4" />
                )}
                {hasGeneratedSkill ? "Regenerar com IA Agent" : "Gerar com IA Agent"}
              </Button>
              <Button size="sm" onClick={() => setSkill("new")}>
                <Plus className="mr-1 h-4 w-4" /> Nova skill
              </Button>
            </div>
          </div>
          {skills.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma skill para este agente. Gere uma a partir da descrição ou crie manualmente.
            </p>
          ) : (
            <ul className="space-y-2">
              {skills.map((s) => (
                <li key={s.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{s.name}</div>
                    <div className="truncate text-sm text-muted-foreground">{s.description}</div>
                  </div>
                  <Switch
                    checked={s.enabled}
                    onCheckedChange={async (v) => {
                      try {
                        await updateAiSkill(accountId, s.id, { enabled: v });
                        onChanged();
                      } catch (e) {
                        toast.error(errMsg(e, "Falha ao atualizar"));
                      }
                    }}
                    aria-label={`Skill ${s.name} ativa`}
                  />
                  <Button size="sm" variant="outline" onClick={() => setSkill(s)}>
                    Editar
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <ToolsSection
          accountId={accountId}
          title="Skills-tool deste agente"
          tools={tools}
          connections={data.connections ?? { postgresql: false, mssql: false }}
          tenants={data.tenants}
          showConnections={false}
          onNew={() => setTool("new")}
          onEdit={(t) => setTool(t)}
          onOpenIntegrations={onOpenIntegrations}
          onChanged={onChanged}
        />
      </div>

      {skill && (
        <SkillDialog
          accountId={accountId}
          skill={skill === "new" ? null : skill}
          personaId={selected.id}
          onClose={() => setSkill(null)}
          onSaved={onChanged}
        />
      )}
      {tool && (
        <ToolDialog
          accountId={accountId}
          tool={tool === "new" ? null : tool}
          personaId={selected.id}
          connections={data.connections ?? { postgresql: false, mssql: false }}
          onClose={() => setTool(null)}
          onSaved={onChanged}
        />
      )}
      {generatingFor && (
        <SkillGenerationDialog
          accountId={accountId}
          input={generatingFor}
          onClose={() => setGeneratingFor(null)}
          onDone={(s) => {
            toast.success(
              hasGeneratedSkill
                ? `Skill "${s.name}" regenerada pelo IA Agent`
                : `Skill "${s.name}" criada pelo IA Agent`,
            );
            setGeneratingFor(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

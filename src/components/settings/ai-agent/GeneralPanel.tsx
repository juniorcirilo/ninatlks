// Aba "Skills (Geral)": a skill global do sistema, skills de toda a conta e
// ferramentas gerais (valem para todos os agentes).
import { useState } from "react";
import { Lock, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  updateAiSkill,
  type AiAgentOverview,
  type AiAgentSkill,
  type AiAgentTool,
} from "@/lib/ai-agent";
import { errMsg } from "./shared";
import { SkillDialog } from "./SkillDialog";
import { ToolDialog } from "./ToolDialog";
import { ToolsSection } from "./ToolsSection";

export function GeneralPanel({
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
  const [skill, setSkill] = useState<AiAgentSkill | "new" | null>(null);
  const [tool, setTool] = useState<AiAgentTool | "new" | null>(null);
  const [showGlobal, setShowGlobal] = useState(false);
  const { global_skill } = data;
  const skills = data.skills.filter((s) => !s.persona_id);
  const tools = data.tools.filter((t) => !t.persona_id);
  const connections = data.connections ?? { postgresql: false, mssql: false };

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold">Skills gerais</h3>
            <p className="text-sm text-muted-foreground">
              Valem para todos os agentes. O IA Agent recebe estas instruções e as usa quando
              relevantes. A skill global abaixo vale sempre.
            </p>
          </div>
          <Button size="sm" onClick={() => setSkill("new")}>
            <Plus className="mr-1 h-4 w-4" /> Nova skill
          </Button>
        </div>

        <ul className="space-y-2">
          <li className="flex items-center gap-3 rounded-xl border border-primary/40 bg-card p-3">
            <Lock className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-medium">{global_skill.name}</span>
                <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] text-primary-foreground">
                  global · sempre ativa
                </span>
              </div>
              <div className="truncate text-sm text-muted-foreground">
                O agente não escreve, executa, revisa nem explica código. Única exceção: consultas
                de leitura nas ferramentas de banco.
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => setShowGlobal(true)}>
              Ver
            </Button>
          </li>
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
        {skills.length === 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            Nenhuma skill geral sua ainda. Crie uma para ensinar todos os agentes a tratar um tipo
            de atendimento (ex.: segunda via de boleto, agendamento, troca).
          </p>
        )}
      </section>

      <ToolsSection
        accountId={accountId}
        title="Skills-tool gerais (todos os agentes)"
        tools={tools}
        connections={connections}
        tenants={data.tenants}
        onNew={() => setTool("new")}
        onEdit={(t) => setTool(t)}
        onOpenIntegrations={onOpenIntegrations}
        onChanged={onChanged}
      />

      {showGlobal && (
        <Dialog open onOpenChange={(o) => !o && setShowGlobal(false)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Lock className="h-4 w-4" /> {global_skill.name}
              </DialogTitle>
              <DialogDescription>
                Skill do sistema: aplicada a todas as respostas e não pode ser editada nem
                desativada.
              </DialogDescription>
            </DialogHeader>
            <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-4 text-sm">
              {global_skill.body}
            </pre>
          </DialogContent>
        </Dialog>
      )}
      {skill && (
        <SkillDialog
          accountId={accountId}
          skill={skill === "new" ? null : skill}
          onClose={() => setSkill(null)}
          onSaved={onChanged}
        />
      )}
      {tool && (
        <ToolDialog
          accountId={accountId}
          tool={tool === "new" ? null : tool}
          connections={connections}
          onClose={() => setTool(null)}
          onSaved={onChanged}
        />
      )}
    </div>
  );
}

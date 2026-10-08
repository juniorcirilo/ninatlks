import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
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
import { createAiSkill, deleteAiSkill, updateAiSkill, type AiAgentSkill } from "@/lib/ai-agent";
import { errMsg } from "./shared";

export function SkillDialog({
  accountId,
  skill,
  personaId,
  onClose,
  onSaved,
}: {
  accountId: string;
  skill: AiAgentSkill | null;
  /** ao criar, vincula a skill a este agente */
  personaId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [body, setBody] = useState(skill?.body ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      if (skill) await updateAiSkill(accountId, skill.id, { name, description, body });
      else await createAiSkill(accountId, { name, description, body, personaId });
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errMsg(e, "Não foi possível salvar a skill"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{skill ? "Editar skill" : "Nova skill"}</DialogTitle>
          <DialogDescription>
            Entra nas instruções do IA Agent. A descrição diz ao agente QUANDO usar a skill. A skill
            global (sem código) continua valendo sobre qualquer skill sua.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Segunda via de boleto"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Quando usar</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Cliente pede segunda via de boleto ou fala de vencimento"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Instruções (Markdown)</Label>
            <Textarea
              rows={10}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {skill ? (
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={async () => {
                if (!window.confirm("Excluir esta skill?")) return;
                try {
                  await deleteAiSkill(accountId, skill.id);
                  onSaved();
                  onClose();
                } catch (e) {
                  toast.error(errMsg(e, "Falha ao excluir"));
                }
              }}
            >
              <Trash2 className="mr-1 h-4 w-4" /> Excluir
            </Button>
          ) : (
            <span />
          )}
          <Button disabled={saving || !name.trim() || !description.trim()} onClick={save}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

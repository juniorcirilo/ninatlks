import { useState } from "react";
import { Database, Loader2, Trash2 } from "lucide-react";
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
  createAiTool,
  deleteAiTool,
  updateAiTool,
  type AiAgentTool,
  type DbConnection,
} from "@/lib/ai-agent";
import { CONN_LABEL, errMsg } from "./shared";

export function ToolDialog({
  accountId,
  tool,
  personaId,
  connections,
  onClose,
  onSaved,
}: {
  accountId: string;
  tool: AiAgentTool | null;
  /** ao criar, vincula a ferramenta a este agente */
  personaId?: string;
  connections: Record<DbConnection, boolean>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(tool?.name ?? "");
  const [connection, setConnection] = useState<DbConnection>(
    tool?.connection ?? (connections.postgresql || !connections.mssql ? "postgresql" : "mssql"),
  );
  const [description, setDescription] = useState(tool?.description ?? "");
  const [maxRows, setMaxRows] = useState(tool?.max_rows ?? 50);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const rows = Math.min(200, Math.max(1, Math.round(maxRows) || 50));
      if (tool) await updateAiTool(accountId, tool.id, { name, description, maxRows: rows });
      else
        await createAiTool(accountId, { name, connection, description, maxRows: rows, personaId });
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errMsg(e, "Não foi possível salvar a ferramenta"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-4 w-4" />{" "}
            {tool ? "Editar ferramenta" : "Nova ferramenta de banco"}
          </DialogTitle>
          <DialogDescription>
            O agente lista tabelas e procedures, lê a estrutura e monta a consulta sozinho. Acesso
            somente leitura; todas as consultas ficam registradas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Consultar ERP"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Banco de dados</Label>
            <Select
              value={connection}
              onValueChange={(v) => setConnection(v as DbConnection)}
              disabled={!!tool}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CONN_LABEL) as DbConnection[]).map((c) => (
                  <SelectItem key={c} value={c}>
                    {CONN_LABEL[c]}
                    {connections[c] ? "" : " (sem credenciais)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Contexto do banco (opcional)</Label>
            <Textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex.: Tabela clientes (telefone, nome), títulos em contas_receber, boletos em cobranca. Todas têm client_id (o tenant). O cliente da conversa é identificado pelo telefone."
            />
            <p className="text-xs text-muted-foreground">
              Ajuda o agente a achar as tabelas certas mais rápido.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Máximo de linhas por consulta</Label>
            <Input
              type="number"
              min={1}
              max={200}
              value={maxRows}
              onChange={(e) => setMaxRows(Number(e.target.value))}
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {tool ? (
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={async () => {
                if (!window.confirm("Excluir esta ferramenta?")) return;
                try {
                  await deleteAiTool(accountId, tool.id);
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
          <Button disabled={saving || !name.trim()} onClick={save}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

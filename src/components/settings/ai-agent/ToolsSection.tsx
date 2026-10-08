import { useState } from "react";
import { Database, Loader2, Plus } from "lucide-react";
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
  testDbConnection,
  updateAiTool,
  type AiAgentTool,
  type DbConnection,
} from "@/lib/ai-agent";
import { CONN_LABEL, errMsg } from "./shared";

export function ToolsSection({
  accountId,
  tools,
  connections,
  tenants,
  onNew,
  onEdit,
  onOpenIntegrations,
  onChanged,
  title = "Ferramentas do agente",
  showConnections = true,
}: {
  accountId: string;
  tools: AiAgentTool[];
  connections: Record<DbConnection, boolean>;
  /** Client ID (tenant) configurado por conexão */
  tenants?: Record<DbConnection, boolean>;
  onNew: () => void;
  onEdit: (t: AiAgentTool) => void;
  onOpenIntegrations?: () => void;
  onChanged: () => void;
  title?: string;
  /** mostra o status/teste das conexões PostgreSQL e SQL Server */
  showConnections?: boolean;
}) {
  const [testing, setTesting] = useState<DbConnection | null>(null);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">
            Acesso <strong>somente leitura</strong> a bancos de dados: o agente analisa as tabelas e
            procedures, monta a consulta e traz o resultado para responder ao cliente. Use um
            usuário do banco só com SELECT (as procedures são lidas para entender a regra, nunca
            executadas). O banco é multi-tenant: toda consulta é filtrada pelo{" "}
            <code>client_id</code> configurado em Integrações.
          </p>
        </div>
        <Button size="sm" onClick={onNew}>
          <Plus className="mr-1 h-4 w-4" /> Nova ferramenta
        </Button>
      </div>

      <div className={showConnections ? "mb-3 flex flex-wrap gap-2" : "hidden"}>
        {(Object.keys(CONN_LABEL) as DbConnection[]).map((c) => (
          <div
            key={c}
            className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm"
          >
            <Database className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span className="font-medium">{CONN_LABEL[c]}</span>
            {connections[c] ? (
              <>
                <span className="text-muted-foreground">credenciais salvas</span>
                {tenants && !tenants[c] && (
                  <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] text-amber-500">
                    falta o Client ID (tenant)
                  </span>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={testing !== null}
                  onClick={async () => {
                    setTesting(c);
                    try {
                      const r = await testDbConnection(accountId, c);
                      toast.success(r.message);
                    } catch (e) {
                      toast.error(errMsg(e, "Falha na conexão"));
                    } finally {
                      setTesting(null);
                    }
                  }}
                >
                  {testing === c && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                  Testar
                </Button>
              </>
            ) : (
              <>
                <span className="text-muted-foreground">sem credenciais</span>
                {onOpenIntegrations && (
                  <Button size="sm" variant="outline" onClick={onOpenIntegrations}>
                    Configurar em Integrações
                  </Button>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {tools.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma ferramenta ainda. Cadastre as credenciais em Integrações e crie uma ferramenta
          (ex.: &quot;Consultar ERP&quot;) para o agente acessar o banco.
        </p>
      ) : (
        <ul className="space-y-2">
          {tools.map((t) => (
            <li key={t.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
              <Database className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{t.name}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
                    {CONN_LABEL[t.connection]} · somente leitura
                  </span>
                  {!connections[t.connection] && (
                    <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] text-amber-500">
                      sem credenciais
                    </span>
                  )}
                </div>
                <div className="truncate text-sm text-muted-foreground">
                  {t.description || `até ${t.max_rows} linhas por consulta`}
                </div>
              </div>
              <Switch
                checked={t.enabled}
                onCheckedChange={async (v) => {
                  try {
                    await updateAiTool(accountId, t.id, { enabled: v });
                    onChanged();
                  } catch (e) {
                    toast.error(errMsg(e, "Falha ao atualizar"));
                  }
                }}
                aria-label={`Ferramenta ${t.name} ativa`}
              />
              <Button size="sm" variant="outline" onClick={() => onEdit(t)}>
                Editar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

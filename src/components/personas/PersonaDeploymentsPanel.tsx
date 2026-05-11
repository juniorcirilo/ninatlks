/**
 * Persona Deployments Panel — manage per-inbox deployments for a single persona.
 * Lists every inbox in the account, lets admin enable, choose mode/autonomy/threshold.
 */
import { useState, useEffect, useCallback } from "react";
import { Power, Loader2, Inbox as InboxIcon } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchDeployments,
  deployPersona,
  deleteDeployment,
  MODE_LABELS,
  AUTONOMY_LABELS,
  type PersonaDeployment,
  type DeploymentMode,
  type DeploymentAutonomy,
} from "@/lib/personas";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Inbox = { id: string; name: string; channel_type: string | null };

export function PersonaDeploymentsPanel({
  personaId,
  accountId,
}: {
  personaId: string;
  accountId: string;
}) {
  const [inboxes, setInboxes] = useState<Inbox[]>([]);
  const [deployments, setDeployments] = useState<Record<string, PersonaDeployment>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: inboxData }, deps] = await Promise.all([
        supabase
          .from("inboxes")
          .select("id, name, channel_type")
          .eq("account_id", accountId)
          .eq("enabled", true)
          .order("name"),
        fetchDeployments(personaId),
      ]);
      setInboxes((inboxData ?? []) as Inbox[]);
      const map: Record<string, PersonaDeployment> = {};
      for (const d of deps) map[d.inbox_id] = d;
      setDeployments(map);
    } finally {
      setLoading(false);
    }
  }, [personaId, accountId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
      </div>
    );
  }

  if (inboxes.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/40 p-4 text-center text-[11px] text-muted-foreground">
        Nenhuma caixa de entrada configurada. Crie uma em Canais primeiro.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {inboxes.map((inbox) => (
        <DeploymentRow
          key={inbox.id}
          inbox={inbox}
          deployment={deployments[inbox.id]}
          personaId={personaId}
          accountId={accountId}
          onChange={load}
        />
      ))}
    </div>
  );
}

function DeploymentRow({
  inbox,
  deployment,
  personaId,
  accountId,
  onChange,
}: {
  inbox: Inbox;
  deployment?: PersonaDeployment;
  personaId: string;
  accountId: string;
  onChange: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const enabled = deployment?.enabled ?? false;

  const upsert = async (patch: Partial<PersonaDeployment>) => {
    setSaving(true);
    try {
      await deployPersona({
        personaId,
        accountId,
        inboxId: inbox.id,
        enabled: patch.enabled ?? deployment?.enabled ?? false,
        mode: (patch.mode ?? deployment?.mode ?? "always") as DeploymentMode,
        autonomy: (patch.autonomy ?? deployment?.autonomy ?? "suggest") as DeploymentAutonomy,
        confidenceThreshold: patch.confidence_threshold ?? deployment?.confidence_threshold ?? 0.7,
        dailyMessageBudget: patch.daily_message_budget ?? deployment?.daily_message_budget ?? 100,
      });
      onChange();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar deployment");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async () => {
    if (!deployment) {
      await upsert({ enabled: true });
      toast.success(`Persona implantada em ${inbox.name}`);
    } else if (enabled) {
      // disable by deleting (simpler than update)
      try {
        await deleteDeployment(deployment.id);
        onChange();
        toast.success(`Removido de ${inbox.name}`);
      } catch (e: any) {
        toast.error(e.message ?? "Erro");
      }
    } else {
      await upsert({ enabled: true });
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-colors",
        enabled
          ? "border-primary/40 bg-primary/5"
          : "border-border bg-muted/40",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <InboxIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div className="text-[12px] font-semibold truncate">{inbox.name}</div>
            <div className="text-[10px] text-muted-foreground">{inbox.channel_type ?? "—"}</div>
          </div>
        </div>
        <button
          onClick={handleToggle}
          disabled={saving}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold transition-colors disabled:opacity-50",
            enabled
              ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
              : "bg-muted text-muted-foreground hover:text-foreground",
          )}
        >
          {saving ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Power className="h-3 w-3" />
          )}
          {enabled ? "Ativa" : "Inativa"}
        </button>
      </div>

      {enabled && deployment && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Modo</label>
            <select
              value={deployment.mode}
              onChange={(e) => upsert({ mode: e.target.value as DeploymentMode })}
              className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1 text-[11px]"
            >
              {Object.entries(MODE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Autonomia</label>
            <select
              value={deployment.autonomy}
              onChange={(e) => upsert({ autonomy: e.target.value as DeploymentAutonomy })}
              className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1 text-[11px]"
            >
              {Object.entries(AUTONOMY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between">
              <label className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">
                Confiança mínima
              </label>
              <span className="text-[10px] font-mono text-primary">
                {Math.round((deployment.confidence_threshold ?? 0.7) * 100)}%
              </span>
            </div>
            <Slider
              value={[deployment.confidence_threshold ?? 0.7]}
              min={0}
              max={1}
              step={0.05}
              onValueChange={([v]) => upsert({ confidence_threshold: v })}
              className="mt-2"
            />
          </div>
        </div>
      )}
    </div>
  );
}

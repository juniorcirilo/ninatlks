import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  Plus,
  Phone,
  MessageCircle,
  Mail,
  Trash2,
  Pencil,
  PowerOff,
  Power,
  Sparkles,
} from "lucide-react";
import { useAccount } from "@/lib/account-context";
import {
  fetchCadences,
  upsertCadence,
  deleteCadence,
  TRIGGER_LABEL,
  CHANNEL_LABEL,
  type Cadence,
  type CadenceChannel,
  type CadenceTriggerEvent,
  type CadenceStep,
} from "@/lib/cadences";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/follow-ups")({
  head: () => ({
    meta: [
      { title: "Follow-ups — Nina Talks" },
      {
        name: "description",
        content: "Cadências de follow-up para reengajar leads.",
      },
    ],
  }),
  component: FollowUpsPage,
});

const CHANNEL_ICONS: Record<CadenceChannel, React.ComponentType<{ className?: string }>> = {
  voice: Phone,
  whatsapp: MessageCircle,
  email: Mail,
};

function FollowUpsPage() {
  const { accountId } = useAccount();
  const [data, setData] = useState<Cadence[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Cadence | "new" | null>(null);

  const refresh = useCallback(async () => {
    if (!accountId) {
      setLoading(false);
      return;
    }
    try {
      const c = await fetchCadences(accountId);
      setData(c);
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao carregar cadências");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleToggleEnabled(cadence: Cadence) {
    if (!accountId) return;
    try {
      await upsertCadence({
        id: cadence.id,
        account_id: accountId,
        name: cadence.name,
        description: cadence.description,
        trigger_event: cadence.trigger_event,
        trigger_stage_id: cadence.trigger_stage_id,
        steps: cadence.steps,
        enabled: !cadence.enabled,
      });
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao alternar");
    }
  }

  async function handleDelete(cadence: Cadence) {
    if (!confirm(`Remover cadência "${cadence.name}"? Execuções pendentes serão canceladas.`)) {
      return;
    }
    if (!accountId) return;
    try {
      await deleteCadence(accountId, cadence.id);
      toast.success("Cadência removida");
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao remover");
    }
  }

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-6">
      <header className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Follow-ups</h1>
          <p className="text-xs text-muted-foreground">
            Cadências automáticas pra reengajar leads. A Nina executa cada step no canal
            configurado.
          </p>
        </div>
        <Button onClick={() => setEditing("new")} size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          Nova cadência
        </Button>
      </header>

      {data.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.06] py-16 text-center">
          <Sparkles className="mb-2 h-5 w-5 text-violet-400" />
          <p className="text-sm text-slate-200">Nenhuma cadência configurada</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Crie uma cadência pra Nina ligar ou mandar WhatsApp em momentos estratégicos do funil.
          </p>
          <Button
            onClick={() => setEditing("new")}
            size="sm"
            variant="outline"
            className="mt-4 gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Criar primeira cadência
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {data.map((c) => (
            <CadenceRow
              key={c.id}
              cadence={c}
              onEdit={() => setEditing(c)}
              onToggle={() => handleToggleEnabled(c)}
              onDelete={() => handleDelete(c)}
            />
          ))}
        </div>
      )}

      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent className="w-[520px] sm:max-w-[520px] overflow-y-auto">
          {editing && (
            <CadenceForm
              accountId={accountId}
              initial={editing === "new" ? null : editing}
              onSaved={() => {
                setEditing(null);
                refresh();
              }}
              onCancel={() => setEditing(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function CadenceRow({
  cadence,
  onEdit,
  onToggle,
  onDelete,
}: {
  cadence: Cadence;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-xl border bg-white/[0.02] p-4",
        cadence.enabled ? "border-white/[0.06]" : "border-white/[0.03] opacity-60",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-slate-200">{cadence.name}</span>
          <span className="rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-300 ring-1 ring-violet-500/20">
            {TRIGGER_LABEL[cadence.trigger_event]}
          </span>
          {!cadence.enabled && (
            <span className="rounded-md bg-slate-500/15 px-1.5 py-0.5 text-[10px] text-slate-400 ring-1 ring-slate-500/20">
              Pausada
            </span>
          )}
        </div>
        {cadence.description && (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{cadence.description}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {cadence.steps.map((s, i) => (
            <StepChip key={i} step={s} />
          ))}
          {cadence.steps.length === 0 && (
            <span className="text-[11px] text-muted-foreground">Sem steps</span>
          )}
        </div>
        <div className="mt-2 flex gap-3 text-[10px] text-muted-foreground">
          <span>{cadence.pending_count} pendentes</span>
          <span>·</span>
          <span>{cadence.waiting_count} aguardando ligação</span>
          <span>·</span>
          <span>{cadence.completed_count} concluídas</span>
          {cadence.failed_count > 0 && (
            <>
              <span>·</span>
              <span className="text-destructive">{cadence.failed_count} falharam</span>
            </>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={onToggle}
          title={cadence.enabled ? "Pausar" : "Reativar"}
          className="rounded-md p-1.5 text-slate-400 hover:bg-white/[0.05] hover:text-slate-200"
        >
          {cadence.enabled ? (
            <PowerOff className="h-3.5 w-3.5" />
          ) : (
            <Power className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          onClick={onEdit}
          title="Editar"
          className="rounded-md p-1.5 text-slate-400 hover:bg-white/[0.05] hover:text-slate-200"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onDelete}
          title="Remover"
          className="rounded-md p-1.5 text-rose-400/70 hover:bg-rose-500/10 hover:text-rose-300"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function StepChip({ step }: { step: CadenceStep }) {
  const Icon = CHANNEL_ICONS[step.channel];
  const offset = step.offset_hours;
  const offsetLabel =
    offset === 0 ? "imediato" : offset < 24 ? `+${offset}h` : `+${Math.round(offset / 24)}d`;
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-white/[0.06] bg-white/[0.02] px-1.5 py-0.5 text-[10px] text-slate-300">
      <Icon className="h-3 w-3 text-violet-400" />
      {CHANNEL_LABEL[step.channel]} · {offsetLabel}
    </span>
  );
}

function CadenceForm({
  accountId,
  initial,
  onSaved,
  onCancel,
}: {
  accountId: string | null;
  initial: Cadence | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [triggerEvent, setTriggerEvent] = useState<CadenceTriggerEvent>(
    initial?.trigger_event ?? "manual",
  );
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [steps, setSteps] = useState<CadenceStep[]>(
    initial?.steps && initial.steps.length > 0
      ? initial.steps
      : [{ offset_hours: 24, channel: "voice" }],
  );
  const [saving, setSaving] = useState(false);

  function updateStep(i: number, patch: Partial<CadenceStep>) {
    setSteps((arr) => arr.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function addStep() {
    setSteps((arr) => [
      ...arr,
      {
        offset_hours: arr.length === 0 ? 0 : (arr[arr.length - 1].offset_hours ?? 0) + 48,
        channel: "voice",
      },
    ]);
  }
  function removeStep(i: number) {
    setSteps((arr) => arr.filter((_, idx) => idx !== i));
  }

  async function handleSave() {
    if (!accountId) return;
    if (!name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    if (steps.length === 0) {
      toast.error("Adicione pelo menos 1 step");
      return;
    }
    setSaving(true);
    try {
      await upsertCadence({
        id: initial?.id,
        account_id: accountId,
        name: name.trim(),
        description: description.trim() || null,
        trigger_event: triggerEvent,
        steps,
        enabled,
      });
      toast.success(initial ? "Cadência atualizada" : "Cadência criada");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>{initial ? "Editar cadência" : "Nova cadência"}</SheetTitle>
      </SheetHeader>

      <div className="mt-4 space-y-4">
        <Field label="Nome">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Reengajar leads frios"
          />
        </Field>

        <Field label="Descrição (opcional)">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Quando usar essa cadência"
          />
        </Field>

        <Field label="Disparar quando">
          <Select
            value={triggerEvent}
            onValueChange={(v) => setTriggerEvent(v as CadenceTriggerEvent)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Manual (você inscreve o lead)</SelectItem>
              <SelectItem value="stage_change">Quando entra num stage</SelectItem>
              <SelectItem value="no_show">Quando dá no-show</SelectItem>
              <SelectItem value="meeting_attended">Após reunião realizada</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="mb-2 flex items-center justify-between">
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Ativa
            </label>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Quando pausada, novos leads não são inscritos e execuções pendentes ficam congeladas.
          </p>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Steps
            </label>
            <Button size="sm" variant="ghost" onClick={addStep} className="h-7 gap-1 text-xs">
              <Plus className="h-3 w-3" />
              Adicionar
            </Button>
          </div>
          <div className="space-y-2">
            {steps.map((s, i) => (
              <StepEditor
                key={i}
                step={s}
                onChange={(patch) => updateStep(i, patch)}
                onRemove={() => removeStep(i)}
                index={i}
              />
            ))}
            {steps.length === 0 && (
              <div className="rounded-md border border-dashed border-white/[0.06] px-3 py-4 text-center text-[11px] text-muted-foreground">
                Sem steps. Adicione pelo menos 1.
              </div>
            )}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            <strong>Ligação</strong> e <strong>WhatsApp</strong> disparam de fato. E-mail ainda é
            marcado como concluído sem ação.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            Salvar
          </Button>
        </div>
      </div>
    </>
  );
}

function StepEditor({
  step,
  onChange,
  onRemove,
  index,
}: {
  step: CadenceStep;
  onChange: (patch: Partial<CadenceStep>) => void;
  onRemove: () => void;
  index: number;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Step {index + 1}
        </span>
        <button
          onClick={onRemove}
          className="rounded-md p-1 text-rose-400/70 hover:bg-rose-500/10 hover:text-rose-300"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] text-muted-foreground">Canal</label>
          <Select
            value={step.channel}
            onValueChange={(v) => onChange({ channel: v as CadenceChannel })}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="voice">Ligação</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
              <SelectItem value="email">E-mail</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="block text-[10px] text-muted-foreground">Quando (horas)</label>
          <Input
            type="number"
            min={0}
            value={step.offset_hours}
            onChange={(e) => onChange({ offset_hours: Number(e.target.value) })}
            className="h-9"
          />
        </div>
      </div>
      <p className="mt-1.5 text-[10px] text-muted-foreground">
        {step.offset_hours === 0
          ? "Imediatamente após o trigger"
          : step.offset_hours < 24
            ? `${step.offset_hours} h após o trigger`
            : `${Math.round(step.offset_hours / 24)} dias após o trigger`}
      </p>
      {step.channel === "whatsapp" && (
        <div className="mt-2">
          <label className="block text-[10px] text-muted-foreground">Mensagem</label>
          <Textarea
            value={step.message ?? ""}
            onChange={(e) => onChange({ message: e.target.value })}
            rows={3}
            placeholder="Oi {{nome}}, tudo bem? Passando pra lembrar sobre..."
            className="text-xs"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Use {"{{nome}}"} e outras variáveis do contato entre chaves duplas.
          </p>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

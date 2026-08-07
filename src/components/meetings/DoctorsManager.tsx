import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2, Save, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  fetchDoctors,
  upsertDoctor,
  deleteDoctor,
  setDoctorAvailability,
  type Doctor,
  type DoctorWeeklySlot,
  WEEKDAY_LABEL,
} from "@/lib/meetings";

export function DoctorsManager({ accountId }: { accountId: string }) {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Doctor | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setDoctors(await fetchDoctors(accountId));
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao listar médicos");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Médicos</h2>
          <p className="text-xs text-muted-foreground">
            A Nina usa essa lista para oferecer e marcar consultas.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)} className="gap-1.5">
          <UserPlus className="h-4 w-4" /> Novo médico
        </Button>
      </div>

      {doctors.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card py-12 text-center text-sm text-muted-foreground">
          Nenhum médico cadastrado. Adicione o primeiro para a Nina conseguir agendar.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {doctors.map((d) => (
            <DoctorCard
              key={d.id}
              doctor={d}
              accountId={accountId}
              onEdit={() => setEditing(d)}
              onChanged={refresh}
            />
          ))}
        </div>
      )}

      <DoctorDialog
        open={creating || !!editing}
        doctor={editing}
        accountId={accountId}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
        onSaved={() => {
          setEditing(null);
          setCreating(false);
          refresh();
        }}
      />
    </div>
  );
}

function DoctorCard({
  doctor,
  accountId,
  onEdit,
  onChanged,
}: {
  doctor: Doctor;
  accountId: string;
  onEdit: () => void;
  onChanged: () => void;
}) {
  async function handleDelete() {
    if (!confirm(`Remover ${doctor.name}? As consultas já agendadas mantêm o nome.`)) return;
    try {
      await deleteDoctor(accountId, doctor.id);
      toast.success("Médico removido");
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao remover");
    }
  }
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">{doctor.name}</span>
            {!doctor.active && (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                inativo
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {doctor.specialty ?? "Sem especialidade"} · {doctor.default_duration_minutes}min ·{" "}
            {doctor.modalities.join(", ")}
          </div>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit}>
            Editar
          </Button>
          <Button size="sm" variant="ghost" onClick={handleDelete} className="text-rose-600">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="mt-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Janelas semanais
        </div>
        {doctor.weekly_slots.length === 0 ? (
          <p className="mt-1 text-xs text-amber-700">
            ⚠ Sem janelas configuradas — a Nina não vai oferecer horários para esse médico.
          </p>
        ) : (
          <ul className="mt-1 space-y-0.5 text-xs text-foreground">
            {doctor.weekly_slots.map((s, i) => (
              <li key={i}>
                · {WEEKDAY_LABEL[s.weekday]} {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DoctorDialog({
  open,
  doctor,
  accountId,
  onClose,
  onSaved,
}: {
  open: boolean;
  doctor: Doctor | null;
  accountId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [duration, setDuration] = useState(30);
  const [modPres, setModPres] = useState(true);
  const [modTele, setModTele] = useState(false);
  const [active, setActive] = useState(true);
  const [notes, setNotes] = useState("");
  const [slots, setSlots] = useState<DoctorWeeklySlot[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(doctor?.name ?? "");
    setSpecialty(doctor?.specialty ?? "");
    setDuration(doctor?.default_duration_minutes ?? 30);
    setModPres(doctor?.modalities.includes("presencial") ?? true);
    setModTele(doctor?.modalities.includes("teleconsulta") ?? false);
    setActive(doctor?.active ?? true);
    setNotes(doctor?.notes ?? "");
    setSlots(doctor?.weekly_slots ?? []);
  }, [doctor, open]);

  function addSlot() {
    setSlots((s) => [...s, { weekday: 1, start_time: "09:00:00", end_time: "12:00:00" }]);
  }
  function updateSlot(i: number, patch: Partial<DoctorWeeklySlot>) {
    setSlots((s) => s.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }
  function removeSlot(i: number) {
    setSlots((s) => s.filter((_, idx) => idx !== i));
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    const modalities: string[] = [];
    if (modPres) modalities.push("presencial");
    if (modTele) modalities.push("teleconsulta");
    if (modalities.length === 0) {
      toast.error("Selecione ao menos uma modalidade");
      return;
    }
    setSaving(true);
    try {
      const id = await upsertDoctor({
        id: doctor?.id,
        account_id: accountId,
        name: name.trim(),
        specialty: specialty.trim() || null,
        modalities,
        default_duration_minutes: duration,
        notes: notes.trim() || null,
        active,
      });
      await setDoctorAvailability(accountId, id, slots);
      toast.success(doctor ? "Médico atualizado" : "Médico criado");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{doctor ? "Editar médico" : "Novo médico"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Nome</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Dr. João Pereira"
              />
            </div>
            <div>
              <Label>Especialidade</Label>
              <Input
                value={specialty}
                onChange={(e) => setSpecialty(e.target.value)}
                placeholder="Ortopedia esportiva"
              />
            </div>
            <div>
              <Label>Duração padrão (min)</Label>
              <Input
                type="number"
                min={15}
                max={240}
                step={5}
                value={duration}
                onChange={(e) => setDuration(parseInt(e.target.value) || 30)}
              />
            </div>
            <div className="flex flex-col gap-2 pt-5">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={modPres}
                  onChange={(e) => setModPres(e.target.checked)}
                />{" "}
                Presencial
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={modTele}
                  onChange={(e) => setModTele(e.target.checked)}
                />{" "}
                Teleconsulta
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                />{" "}
                Ativo
              </label>
            </div>
          </div>
          <div>
            <Label>Notas internas (opcional)</Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex.: aceita convênio X, consultas longas para primeira vez…"
            />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label>Janelas semanais</Label>
              <Button size="sm" variant="outline" onClick={addSlot} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Janela
              </Button>
            </div>
            {slots.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Adicione pelo menos uma janela para a Nina ofertar horários.
              </p>
            ) : (
              <div className="space-y-2">
                {slots.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Select
                      value={String(s.weekday)}
                      onValueChange={(v) => updateSlot(i, { weekday: parseInt(v) })}
                    >
                      <SelectTrigger className="w-auto gap-1.5 bg-background text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WEEKDAY_LABEL.map((lbl, idx) => (
                          <SelectItem key={idx} value={String(idx)}>
                            {lbl}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="time"
                      value={s.start_time.slice(0, 5)}
                      onChange={(e) => updateSlot(i, { start_time: e.target.value + ":00" })}
                      className="w-28"
                    />
                    <span className="text-muted-foreground">até</span>
                    <Input
                      type="time"
                      value={s.end_time.slice(0, 5)}
                      onChange={(e) => updateSlot(i, { end_time: e.target.value + ":00" })}
                      className="w-28"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeSlot(i)}
                      className="text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

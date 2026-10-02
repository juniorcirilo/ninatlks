import { useEffect, useState } from "react";
import { Loader2, Video } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createMeeting, fetchDoctors, toLocalInputValue, type Doctor } from "@/lib/meetings";
import { listTeamMembers, type TeamMember } from "@/lib/team";
import { fetchGoogleCalendarStatus, type GoogleCalendarStatus } from "@/lib/google-calendar";

export function NewMeetingDialog({
  open,
  accountId,
  currentUserId,
  presetContact,
  onClose,
  onCreated,
}: {
  open: boolean;
  accountId: string;
  currentUserId: string | null;
  presetContact?: {
    id: string;
    name: string | null;
    email: string | null;
    phone_number: string | null;
  } | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [google, setGoogle] = useState<GoogleCalendarStatus | null>(null);

  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - (d.getMinutes() % 15) + 30, 0, 0);
    return toLocalInputValue(d);
  });
  const [duration, setDuration] = useState(30);
  const [hostUserId, setHostUserId] = useState("");
  const [inviteeName, setInviteeName] = useState("");
  const [inviteeEmail, setInviteeEmail] = useState("");
  const [inviteePhone, setInviteePhone] = useState("");
  const [doctorId, setDoctorId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [useGoogleMeet, setUseGoogleMeet] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDuration(30);
    setHostUserId(currentUserId ?? "");
    setInviteeName(presetContact?.name ?? "");
    setInviteeEmail(presetContact?.email ?? "");
    setInviteePhone(presetContact?.phone_number ?? "");
    setDoctorId("");
    setNotes("");
    const d = new Date();
    d.setMinutes(d.getMinutes() - (d.getMinutes() % 15) + 30, 0, 0);
    setStartsAt(toLocalInputValue(d));

    listTeamMembers(accountId)
      .then(setMembers)
      .catch(() => setMembers([]));
    fetchDoctors(accountId)
      .then(setDoctors)
      .catch(() => setDoctors([]));
    fetchGoogleCalendarStatus(accountId)
      .then((s) => {
        setGoogle(s);
        setUseGoogleMeet(s.connected);
      })
      .catch(() => setGoogle(null));
  }, [open, accountId, currentUserId, presetContact]);

  async function handleSave() {
    if (!hostUserId) {
      toast.error("Escolha quem vai conduzir a reunião");
      return;
    }
    if (!inviteeName.trim() && !inviteePhone.trim() && !inviteeEmail.trim()) {
      toast.error("Informe pelo menos o nome, e-mail ou telefone do convidado");
      return;
    }
    setSaving(true);
    try {
      await createMeeting(accountId, {
        title: title.trim() || undefined,
        startsAt: new Date(startsAt).toISOString(),
        durationMinutes: duration,
        hostUserId,
        inviteeName: inviteeName.trim() || undefined,
        inviteeEmail: inviteeEmail.trim() || undefined,
        inviteePhone: inviteePhone.trim() || undefined,
        contactId: presetContact?.id,
        doctorId: doctorId || undefined,
        notes: notes.trim() || undefined,
        useGoogleMeet: google?.connected ? useGoogleMeet : false,
      });
      toast.success("Reunião criada");
      onCreated();
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao criar reunião");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {presetContact
              ? `Agendar reunião com ${presetContact.name ?? "contato"}`
              : "Nova reunião"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Título (opcional)</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Demonstração do produto"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Data e hora</Label>
              <Input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div>
              <Label>Duração (min)</Label>
              <Input
                type="number"
                min={5}
                max={480}
                step={5}
                value={duration}
                onChange={(e) => setDuration(parseInt(e.target.value) || 30)}
              />
            </div>
          </div>

          <div>
            <Label>Conduzido por</Label>
            <Select value={hostUserId} onValueChange={setHostUserId}>
              <SelectTrigger className="bg-background">
                <SelectValue placeholder="Selecione quem participa" />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.name || m.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Nome do convidado</Label>
              <Input value={inviteeName} onChange={(e) => setInviteeName(e.target.value)} />
            </div>
            <div>
              <Label>Telefone</Label>
              <Input value={inviteePhone} onChange={(e) => setInviteePhone(e.target.value)} />
            </div>
            <div className="col-span-2">
              <Label>E-mail</Label>
              <Input
                type="email"
                value={inviteeEmail}
                onChange={(e) => setInviteeEmail(e.target.value)}
                placeholder="convidado@empresa.com"
              />
            </div>
          </div>

          {doctors.length > 0 && (
            <div>
              <Label>Contato (opcional)</Label>
              <Select value={doctorId || "none"} onValueChange={(v) => setDoctorId(v === "none" ? "" : v)}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Nenhum" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {doctors.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label>Notas (opcional)</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 px-3 py-2.5">
            <div className="flex items-center gap-2 text-sm">
              <Video className="h-4 w-4 text-muted-foreground" />
              <span>Criar com Google Meet</span>
            </div>
            <Switch
              checked={google?.connected ? useGoogleMeet : false}
              onCheckedChange={setUseGoogleMeet}
              disabled={!google?.connected}
            />
          </div>
          {!google?.connected && (
            <p className="-mt-2 text-[11px] text-muted-foreground">
              Conecte o Google Meet em Configurações → Integrações para gerar o link automaticamente.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Criar reunião
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

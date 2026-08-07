import { useEffect, useState } from "react";
import { Loader2, Phone, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchPhoneNumbers, placeCall, type PhoneNumber } from "@/lib/voice";
import { fetchPersonas, type Persona } from "@/lib/personas";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";

export function NewCallDialog({
  open,
  onOpenChange,
  accountId,
  onPlaced,
  initialTo,
  contactId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  accountId: string | null;
  onPlaced?: (callId: string) => void;
  initialTo?: string;
  contactId?: string;
}) {
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialing, setDialing] = useState(false);

  const [fromId, setFromId] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [personaId, setPersonaId] = useState<string>("auto");
  const [notes, setNotes] = useState<string>("");

  useEffect(() => {
    if (!open || !accountId) return;
    setLoading(true);
    setTo(initialTo ?? "");
    Promise.all([fetchPhoneNumbers(accountId), fetchPersonas(accountId)])
      .then(([nums, ps]) => {
        const enabled = nums.filter((n) => n.enabled);
        setNumbers(enabled);
        setPersonas(ps);
        if (enabled.length > 0 && !fromId) {
          setFromId(enabled[0].id);
        }
      })
      .catch((e) => toast.error(e?.message ?? "falha ao carregar dados"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accountId]);

  async function handleDial() {
    if (!fromId || !to.trim() || !accountId) return;
    setDialing(true);
    try {
      const r = await placeCall({
        accountId,
        fromNumberId: fromId,
        toNumber: to.trim(),
        personaId: personaId === "auto" ? undefined : personaId,
        notes: notes.trim() || undefined,
        contactId,
      });
      if (!r.ok) {
        toast.error(r.message ?? `Falha ao discar (${r.reason ?? "erro"})`);
        return;
      }
      if (r.via === "twilio_fallback") {
        toast.warning("ElevenLabs indisponível — chamada saiu via Twilio direto");
      } else if (r.via === "elevenlabs") {
        toast.success(`Nina ligando para ${to}…`);
      } else {
        toast.success(`Chamando ${to}…`);
      }
      onPlaced?.(r.callId);
      onOpenChange(false);
      setTo("");
      setNotes("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "erro";
      toast.error(`Falha: ${msg.slice(0, 200)}`);
    } finally {
      setDialing(false);
    }
  }

  const noNumbers = !loading && numbers.length === 0;
  const canSubmit = !!fromId && to.trim().length >= 8 && !dialing && !noNumbers;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-primary" />
            Nova chamada
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            Disque manualmente. Se o número de origem tiver IA ativa, a Nina conduz a conversa.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : noNumbers ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-xs text-amber-900 dark:text-amber-200">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Você ainda não tem nenhum número conectado.</p>
                <p className="mt-1 opacity-80">
                  Conecte um número Twilio em{" "}
                  <Link
                    to="/phone-numbers"
                    className="underline"
                    onClick={() => onOpenChange(false)}
                  >
                    Números de telefone
                  </Link>{" "}
                  para começar a discar.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleDial();
            }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label
                htmlFor="from-number"
                className="text-[11px] uppercase tracking-wider text-muted-foreground"
              >
                Número de origem
              </Label>
              <Select value={fromId} onValueChange={setFromId}>
                <SelectTrigger id="from-number">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {numbers.map((n) => (
                    <SelectItem key={n.id} value={n.id}>
                      <span className="font-mono text-xs">{n.e164}</span>
                      {n.friendly_name ? ` · ${n.friendly_name}` : ""}
                      {n.elevenlabs_phone_number_id ? " · IA ativa" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="to-number"
                className="text-[11px] uppercase tracking-wider text-muted-foreground"
              >
                Discar para (E.164)
              </Label>
              <Input
                id="to-number"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="+5511999999999"
                autoFocus
                disabled={dialing}
                className="font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="persona"
                className="text-[11px] uppercase tracking-wider text-muted-foreground"
              >
                Agente (opcional)
              </Label>
              <Select value={personaId} onValueChange={setPersonaId}>
                <SelectTrigger id="persona">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Automático (usa o agente fixo do número)</SelectItem>
                  {personas
                    .filter((p) => p.enabled)
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="notes"
                className="text-[11px] uppercase tracking-wider text-muted-foreground"
              >
                Notas internas (opcional)
              </Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Contexto que fica salvo no log da chamada"
                disabled={dialing}
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={dialing}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {dialing ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Phone className="mr-1.5 h-3.5 w-3.5" />
                )}
                Discar
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Modal "Nova sessão": cria o canal, sobe a sessão (Baileys) e mostra o QR em
// tempo real até o WhatsApp conectar. Alternativa ao QR: código de pareamento
// (informando o número do aparelho).
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, QrCode, Smartphone } from "lucide-react";
import { toast } from "sonner";
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
import { cn } from "@/lib/utils";
import { subscribeSessionState } from "@/lib/realtime-client";
import { fetchQrcode, provisionWhatsApp, requestPairingCode } from "@/lib/whatsapp";

type Phase = "form" | "creating" | "pair" | "connected";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accountId: string;
  onChanged: () => void;
}

export function NewWhatsAppSessionDialog({ open, onOpenChange, accountId, onChanged }: Props) {
  const [phase, setPhase] = useState<Phase>("form");
  const [name, setName] = useState("");
  const [channelId, setChannelId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [mode, setMode] = useState<"qr" | "code">("qr");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPhase("form");
    setName("");
    setChannelId(null);
    setQr(null);
    setMode("qr");
    setPhone("");
    setCode(null);
    setBusy(false);
  }, [open]);

  // QR e estado chegam pelo socket; o QR é renovado pelo próprio WhatsApp.
  useEffect(() => {
    if (!open || !channelId) return;
    return subscribeSessionState((ev) => {
      if (ev.channelId !== channelId) return;
      if (ev.qr) setQr(ev.qr);
      if (ev.pairingCode) setCode(ev.pairingCode);
      if (ev.status === "connected") {
        setPhase("connected");
        toast.success("WhatsApp conectado!");
        onChanged();
      }
    });
  }, [open, channelId, onChanged]);

  // Rede de segurança: se o socket cair, o QR continua sendo renovado.
  useEffect(() => {
    if (!open || !channelId || phase !== "pair" || mode !== "qr") return;
    const t = setInterval(() => {
      fetchQrcode(accountId, channelId)
        .then((r) => r.base64 && setQr(r.base64))
        .catch(() => {});
    }, 8000);
    return () => clearInterval(t);
  }, [open, channelId, phase, mode, accountId]);

  async function create() {
    setPhase("creating");
    const r = await provisionWhatsApp({ accountId, channelName: name.trim() || undefined });
    if (!r.ok || !r.channel_id) {
      toast.error(r.error ?? "Falha ao criar a sessão");
      setPhase("form");
      return;
    }
    setChannelId(r.channel_id);
    onChanged();
    setQr(r.qrcode_base64 ?? null);
    setPhase(r.status === "connected" ? "connected" : "pair");
    if (!r.qrcode_base64) {
      // O QR pode demorar alguns segundos; o socket entrega quando sair.
      const again = await fetchQrcode(accountId, r.channel_id);
      if (again.base64) setQr(again.base64);
    }
  }

  async function pairByCode() {
    if (!channelId) return;
    setBusy(true);
    const r = await requestPairingCode(accountId, channelId, phone);
    setBusy(false);
    if (r.error || !r.code) return void toast.error(r.error ?? "Não foi possível gerar o código");
    setCode(r.code);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => phase !== "creating" && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova sessão WhatsApp</DialogTitle>
          <DialogDescription>
            Conecta um número direto ao WhatsApp. Você pode ter várias sessões na mesma conta.
          </DialogDescription>
        </DialogHeader>

        {(phase === "form" || phase === "creating") && (
          <div>
            <Label className="text-[12px]">Nome da sessão</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Comercial"
              disabled={phase === "creating"}
              onKeyDown={(e) => e.key === "Enter" && void create()}
            />
          </div>
        )}

        {phase === "pair" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-border p-1">
              {(
                [
                  ["qr", "QR code", QrCode],
                  ["code", "Código", Smartphone],
                ] as const
              ).map(([k, label, Icon]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setMode(k)}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium transition-colors",
                    mode === k
                      ? "bg-primary/10 text-primary dark:text-cyan-300"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>

            {mode === "qr" ? (
              <div className="flex flex-col items-center gap-3">
                {qr ? (
                  <img
                    src={qr}
                    alt="QR code do WhatsApp"
                    className="h-64 w-64 rounded bg-white p-2"
                  />
                ) : (
                  <div className="flex h-64 w-64 items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                )}
                <p className="text-center text-[12px] text-muted-foreground">
                  WhatsApp › Aparelhos conectados › Conectar um aparelho. O QR se renova sozinho e
                  detectamos a conexão automaticamente.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <Label className="text-[12px]">Número do WhatsApp (com DDI e DDD)</Label>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="5511999999999"
                    inputMode="numeric"
                  />
                </div>
                {code ? (
                  <div className="rounded-lg border border-border p-4 text-center">
                    <div className="text-2xl font-bold tracking-[0.3em]">{code}</div>
                    <p className="mt-2 text-[12px] text-muted-foreground">
                      No celular: Aparelhos conectados › Conectar › Conectar com número de telefone.
                    </p>
                  </div>
                ) : (
                  <Button
                    onClick={pairByCode}
                    disabled={busy || phone.replace(/\D/g, "").length < 10}
                  >
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                    Gerar código
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {phase === "connected" && (
          <div className="flex flex-col items-center gap-2 py-4">
            <CheckCircle2 className="h-10 w-10 text-emerald-400" />
            <p className="text-[13px]">Sessão conectada.</p>
          </div>
        )}

        <DialogFooter>
          {(phase === "form" || phase === "creating") && (
            <Button onClick={create} disabled={phase === "creating"}>
              {phase === "creating" && <Loader2 className="h-4 w-4 animate-spin" />}
              Criar sessão
            </Button>
          )}
          {(phase === "pair" || phase === "connected") && (
            <Button
              variant={phase === "connected" ? "default" : "outline"}
              onClick={() => onOpenChange(false)}
            >
              {phase === "connected" ? "Concluir" : "Fechar"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

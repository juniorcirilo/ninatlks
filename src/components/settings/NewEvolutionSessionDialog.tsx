// Modal "Nova sessão": cria uma instância no Evolution e mostra o QR code
// até o WhatsApp conectar. Reaproveita o servidor já configurado na conta;
// só pede URL + API key quando ainda não existe nenhum.
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw } from "lucide-react";
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
import { fetchEvolutionStatus, fetchQrcode, provisionEvolution } from "@/lib/evolution";

type Phase = "form" | "creating" | "qr" | "connected";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accountId: string;
  /** URL do servidor Evolution já configurado (se houver). */
  knownServerUrl: string | null;
  onChanged: () => void;
}

const NAME_RE = /^[A-Za-z0-9_-]{3,60}$/;
const DEFAULT_URL = "http://evolution:9002";

export function NewEvolutionSessionDialog({
  open,
  onOpenChange,
  accountId,
  knownServerUrl,
  onChanged,
}: Props) {
  const [phase, setPhase] = useState<Phase>("form");
  const [label, setLabel] = useState("");
  const [instanceName, setInstanceName] = useState("");
  const [url, setUrl] = useState(DEFAULT_URL);
  const [apiKey, setApiKey] = useState("");
  const [channelId, setChannelId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);

  const needsServer = !knownServerUrl;

  useEffect(() => {
    if (!open) return;
    setPhase("form");
    setLabel("");
    setInstanceName("");
    setUrl(knownServerUrl ?? DEFAULT_URL);
    setApiKey("");
    setChannelId(null);
    setQr(null);
    setPairingCode(null);
  }, [open, knownServerUrl]);

  // Enquanto aguarda o scan: detecta conexão e renova o QR.
  useEffect(() => {
    if (phase !== "qr" || !channelId) return;
    let cancelled = false;
    const tick = async () => {
      const s = await fetchEvolutionStatus(accountId, channelId);
      if (cancelled) return;
      if (s.status === "connected") {
        setPhase("connected");
        toast.success("WhatsApp conectado!");
        onChanged();
        return;
      }
      const r = await fetchQrcode(accountId, channelId);
      if (!cancelled && r.base64) {
        setQr(r.base64);
        setPairingCode(r.pairingCode ?? null);
      }
    };
    const id = window.setInterval(tick, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [phase, channelId, accountId, onChanged]);

  const name = instanceName.trim();
  const nameOk = name === "" || NAME_RE.test(name);
  const canSubmit = nameOk && (!needsServer || (url.trim() && apiKey.trim()));

  async function create() {
    setPhase("creating");
    const r = await provisionEvolution({
      accountId,
      channelName: label.trim() || undefined,
      instanceName: name || undefined,
      evolutionUrl: needsServer ? url.trim() : undefined,
      evolutionApiKey: needsServer ? apiKey.trim() : undefined,
    });
    if (!r.ok || !r.channel_id) {
      toast.error(r.error ?? "Falha ao criar instância");
      setPhase("form");
      return;
    }
    setChannelId(r.channel_id);
    onChanged();
    let code = r.qrcode_base64 ?? null;
    if (!code) {
      const q = await fetchQrcode(accountId, r.channel_id);
      code = q.base64 ?? null;
      setPairingCode(q.pairingCode ?? null);
    }
    setQr(code);
    setPhase(r.status === "connected" ? "connected" : "qr");
  }

  async function refreshQr() {
    if (!channelId) return;
    const q = await fetchQrcode(accountId, channelId);
    if (q.error) return void toast.error(q.error);
    if (q.base64) setQr(q.base64);
    setPairingCode(q.pairingCode ?? null);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => phase !== "creating" && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova sessão WhatsApp</DialogTitle>
          <DialogDescription>
            Cria uma instância no Evolution e gera o QR code para conectar o número.
          </DialogDescription>
        </DialogHeader>

        {(phase === "form" || phase === "creating") && (
          <div className="space-y-3">
            <div>
              <Label className="text-[12px]">Nome da sessão</Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Ex.: Comercial"
                disabled={phase === "creating"}
              />
            </div>
            <div>
              <Label className="text-[12px]">Nome da instância (opcional)</Label>
              <Input
                value={instanceName}
                onChange={(e) => setInstanceName(e.target.value)}
                placeholder="gerado automaticamente"
                disabled={phase === "creating"}
              />
              {!nameOk && (
                <p className="mt-1 text-[11px] text-red-400">
                  Use 3–60 caracteres: letras, números, _ ou -.
                </p>
              )}
            </div>
            {needsServer ? (
              <>
                <div>
                  <Label className="text-[12px]">URL do servidor Evolution</Label>
                  <Input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={phase === "creating"}
                  />
                </div>
                <div>
                  <Label className="text-[12px]">API key global</Label>
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="AUTHENTICATION_API_KEY"
                    disabled={phase === "creating"}
                  />
                </div>
              </>
            ) : (
              <p className="text-[11px] text-muted-foreground">Servidor: {knownServerUrl}</p>
            )}
          </div>
        )}

        {phase === "qr" && (
          <div className="flex flex-col items-center gap-3">
            {qr ? (
              <img
                src={qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`}
                alt="QR code do WhatsApp"
                className="h-64 w-64 rounded bg-white p-2"
              />
            ) : (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            )}
            {pairingCode && (
              <p className="text-[13px]">
                Código de pareamento: <strong>{pairingCode}</strong>
              </p>
            )}
            <p className="text-center text-[12px] text-muted-foreground">
              WhatsApp › Aparelhos conectados › Conectar um aparelho. Detectamos a conexão
              automaticamente.
            </p>
            <Button variant="outline" size="sm" onClick={refreshQr}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Atualizar QR
            </Button>
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
            <Button onClick={create} disabled={!canSubmit || phase === "creating"}>
              {phase === "creating" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Criar sessão
            </Button>
          )}
          {(phase === "qr" || phase === "connected") && (
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

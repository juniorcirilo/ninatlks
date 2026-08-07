import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Video } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  fetchGoogleCalendarStatus,
  type GoogleCalendarStatus,
} from "@/lib/google-calendar";

export function GoogleCalendarBanner({
  accountId,
  isAdmin,
  refreshKey,
}: {
  accountId: string;
  isAdmin: boolean;
  refreshKey?: unknown;
}) {
  const [status, setStatus] = useState<GoogleCalendarStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchGoogleCalendarStatus(accountId)
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [accountId, refreshKey]);

  if (!status) return null;

  async function handleConnect() {
    setBusy(true);
    try {
      await connectGoogleCalendar(accountId);
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao iniciar conexão com o Google");
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Desconectar o Google Meet desta conta?")) return;
    setBusy(true);
    try {
      await disconnectGoogleCalendar(accountId);
      setStatus((s) => (s ? { ...s, connected: false, email: null } : s));
      toast.success("Google Meet desconectado");
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao desconectar");
    } finally {
      setBusy(false);
    }
  }

  if (status.connected) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-3.5 py-2.5 text-xs">
        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" />
          <span>
            Google Meet conectado{status.email ? ` como ${status.email}` : ""} — novas reuniões
            já ganham link automaticamente.
          </span>
        </div>
        {isAdmin && (
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDisconnect}
            disabled={busy}
            className="h-6 shrink-0 text-[11px] text-muted-foreground"
          >
            Desconectar
          </Button>
        )}
      </div>
    );
  }

  if (!status.configured) return null; // sem GOOGLE_CLIENT_ID no servidor — nada a oferecer ainda

  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-border bg-card px-3.5 py-2.5 text-xs">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Video className="h-4 w-4" />
        <span>Conecte o Google Meet para gerar o link de vídeo automaticamente em cada reunião.</span>
      </div>
      {isAdmin ? (
        <Button
          size="sm"
          variant="outline"
          onClick={handleConnect}
          disabled={busy}
          className="h-7 shrink-0 gap-1.5 text-[11px]"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          Conectar Google Meet
        </Button>
      ) : (
        <span className="shrink-0 text-[11px] text-muted-foreground">peça a um admin para conectar</span>
      )}
    </div>
  );
}

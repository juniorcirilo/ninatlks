// Gestão das sessões WhatsApp (Baileys) sem sair do app: listar, criar, parear
// (QR em tempo real ou código), renomear, ativar/desativar, reiniciar,
// desconectar e excluir.
import { useCallback, useEffect, useState } from "react";
import { Loader2, LogOut, Pencil, Plus, QrCode, RefreshCw, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "@/lib/account-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { NewWhatsAppSessionDialog } from "@/components/settings/NewWhatsAppSessionDialog";
import {
  deleteWhatsAppChannel,
  fetchQrcode,
  listWhatsAppSessions,
  logoutWhatsApp,
  restartWhatsApp,
  updateWhatsAppChannel,
  type WhatsAppSession,
  type WhatsAppStatus,
} from "@/lib/whatsapp";
import { subscribeSessionState } from "@/lib/realtime-client";

const STATUS_LABEL: Record<WhatsAppStatus, string> = {
  connected: "Conectada",
  connecting: "Conectando",
  qr_ready: "Aguardando QR",
  disconnected: "Desconectada",
};

const STATUS_CLASS: Record<WhatsAppStatus, string> = {
  connected: "bg-emerald-500/15 text-emerald-400",
  connecting: "bg-amber-500/15 text-amber-400",
  qr_ready: "bg-sky-500/15 text-sky-400",
  disconnected: "bg-foreground/[0.06] text-muted-foreground",
};

export function WhatsAppSessionsTab() {
  const { accountId } = useAccount();
  const [channels, setChannels] = useState<WhatsAppSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [renaming, setRenaming] = useState<WhatsAppSession | null>(null);
  const [newName, setNewName] = useState("");
  const [deleting, setDeleting] = useState<WhatsAppSession | null>(null);
  const [qr, setQr] = useState<{
    channelId: string;
    name: string;
    base64?: string | null;
    pairingCode?: string | null;
  } | null>(null);

  const refresh = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      setChannels(await listWhatsAppSessions(accountId));
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao carregar sessões.");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusyId(id);
    try {
      await fn();
      toast.success(ok);
      await refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Operação falhou.");
    } finally {
      setBusyId(null);
    }
  };

  const showQr = async (c: WhatsAppSession) => {
    if (!accountId) return;
    setBusyId(c.id);
    const r = await fetchQrcode(accountId, c.id);
    setBusyId(null);
    if (r.error || (!r.base64 && !r.pairingCode)) {
      toast.error(r.error ?? "QR indisponível — a sessão pode já estar conectada.");
      return;
    }
    setQr({ channelId: c.id, name: c.name, base64: r.base64, pairingCode: r.pairingCode });
  };

  // Estado e QR chegam em tempo real pelo socket (sem polling).
  useEffect(() => {
    return subscribeSessionState((ev) => {
      setChannels((list) =>
        list.map((c) =>
          c.id === ev.channelId ? { ...c, status: ev.status, phone: ev.phone ?? c.phone } : c,
        ),
      );
      setQr((cur) => {
        if (!cur || cur.channelId !== ev.channelId) return cur;
        if (ev.status === "connected") return null;
        return {
          ...cur,
          base64: ev.qr ?? cur.base64,
          pairingCode: ev.pairingCode ?? cur.pairingCode,
        };
      });
      if (ev.status === "connected") void refresh();
    });
  }, [refresh]);

  if (!accountId) return null;

  return (
    <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold">WhatsApp</h3>
          <p className="text-[12px] text-muted-foreground">
            Sessões conectadas direto ao WhatsApp (várias por conta). Os dados ficam no servidor.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Nova sessão
          </Button>
        </div>
      </div>

      {loading && channels.length === 0 ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : channels.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-muted-foreground">
          Nenhuma sessão WhatsApp criada ainda.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {channels.map((c) => {
            const st: WhatsAppStatus = c.status;
            const busy = busyId === c.id;
            return (
              <div key={c.id} className="glass flex flex-col gap-3 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  {c.profile_pic_url ? (
                    <img
                      src={c.profile_pic_url}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] text-[16px] font-semibold">
                      {(c.profile_name ?? c.name).slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{c.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {c.profile_name ?? "—"} {c.phone && `· +${c.phone}`}
                    </div>
                    {!c.phone && (
                      <div className="truncate text-[10px] text-muted-foreground">Não pareada</div>
                    )}
                  </div>
                  <Badge className={STATUS_CLASS[st]}>{STATUS_LABEL[st]}</Badge>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  {(
                    [
                      ["Contatos", c.counts.contacts],
                      ["Conversas", c.counts.chats],
                      ["Mensagens", c.counts.messages],
                    ] as const
                  ).map(([label, n]) => (
                    <div key={label} className="rounded-md bg-foreground/[0.03] py-2">
                      <div className="text-[14px] font-semibold">{n.toLocaleString("pt-BR")}</div>
                      <div className="text-[10px] text-muted-foreground">{label}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-auto flex items-center justify-between border-t border-foreground/[0.06] pt-3">
                  <Switch
                    checked={c.enabled}
                    disabled={busy}
                    onCheckedChange={(v) =>
                      run(
                        c.id,
                        () => updateWhatsAppChannel(accountId, c.id, { enabled: v }),
                        v ? "Sessão ativada." : "Sessão desativada.",
                      )
                    }
                    aria-label="Ativar sessão"
                  />
                  <div className="flex items-center gap-0.5">
                    {st !== "connected" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={busy}
                        title="Conectar (QR code)"
                        onClick={() => showQr(c)}
                      >
                        <QrCode className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      title="Renomear"
                      onClick={() => {
                        setRenaming(c);
                        setNewName(c.name);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={busy}
                        title="Reiniciar"
                        onClick={() =>
                          run(c.id, () => restartWhatsApp(accountId, c.id), "Sessão reiniciada.")
                        }
                      >
                        <RotateCw className="h-4 w-4" />
                      </Button>
                    }
                    {st === "connected" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={busy}
                        title="Desconectar WhatsApp"
                        onClick={() =>
                          run(c.id, () => logoutWhatsApp(accountId, c.id), "Sessão desconectada.")
                        }
                      >
                        <LogOut className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      title="Excluir"
                      onClick={() => setDeleting(c)}
                    >
                      <Trash2 className="h-4 w-4 text-red-400" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <NewWhatsAppSessionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        accountId={accountId}
        onChanged={refresh}
      />

      <Dialog open={!!renaming} onOpenChange={(v) => !v && setRenaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renomear sessão</DialogTitle>
          </DialogHeader>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
          <DialogFooter>
            <Button
              disabled={!newName.trim()}
              onClick={async () => {
                const c = renaming!;
                setRenaming(null);
                await run(
                  c.id,
                  () => updateWhatsAppChannel(accountId, c.id, { name: newName }),
                  "Sessão renomeada.",
                );
              }}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!qr} onOpenChange={(v) => !v && setQr(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>QR code — {qr?.name}</DialogTitle>
          </DialogHeader>
          {qr?.base64 && (
            <img
              src={qr.base64.startsWith("data:") ? qr.base64 : `data:image/png;base64,${qr.base64}`}
              alt="QR code do WhatsApp"
              className="mx-auto h-64 w-64 rounded bg-white p-2"
            />
          )}
          {qr?.pairingCode && (
            <p className="text-center text-[13px]">
              Código de pareamento: <strong>{qr.pairingCode}</strong>
            </p>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir sessão “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              A sessão será desvinculada do WhatsApp, os dados dela serão apagados do servidor e o
              canal removido do app. Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const c = deleting!;
                setDeleting(null);
                await run(c.id, () => deleteWhatsAppChannel(accountId, c.id), "Sessão excluída.");
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Envia um cartão de contato (vCard) escolhendo da agenda do WhatsApp ou digitando.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
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
import { ContactAvatar } from "@/components/inbox/ContactAvatar";
import { fetchDirectoryContacts } from "@/lib/inbox";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accountId: string | null | undefined;
  onSend: (contact: { name: string; phone: string }) => Promise<void>;
}

export function ContactCardDialog({ open, onOpenChange, accountId, onSend }: Props) {
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setName("");
    setPhone("");
  }, [open]);

  const { data } = useQuery({
    queryKey: ["directory-contacts", accountId],
    queryFn: () => fetchDirectoryContacts(accountId!),
    enabled: open && !!accountId,
    staleTime: 60_000,
  });

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (data?.items ?? []).filter((c) => !!c.phone);
    if (!q) return list.slice(0, 6);
    return list
      .filter((c) => (c.name ?? "").toLowerCase().includes(q) || (c.phone ?? "").includes(q))
      .slice(0, 6);
  }, [data, query]);

  const canSend = !!name.trim() && phone.replace(/\D/g, "").length >= 8;

  const submit = async () => {
    setBusy(true);
    try {
      await onSend({ name: name.trim(), phone: phone.replace(/\D/g, "") });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="gap-3 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Enviar contato</DialogTitle>
          <DialogDescription className="text-xs">
            Escolha da sua agenda ou informe nome e telefone.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-gray-400" />
          <Input
            className="h-8 pl-8 text-xs"
            placeholder="Buscar na agenda…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {matches.length > 0 && (
          <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-border p-1">
            {matches.map((c) => (
              <li key={c.jid}>
                <button
                  type="button"
                  onClick={() => {
                    setName(c.name ?? c.phone ?? "");
                    setPhone(c.phone ?? "");
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-gray-100 dark:hover:bg-slate-800"
                >
                  <ContactAvatar src={c.picture} name={c.name ?? c.phone ?? ""} className="h-6 w-6" />
                  <span className="min-w-0 flex-1 truncate">{c.name ?? c.phone}</span>
                  <span className="text-[10px] text-gray-400">{c.phone}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Input
            className="h-8 text-xs"
            placeholder="Nome"
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            className="h-8 text-xs"
            placeholder="5511999999999"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <DialogFooter className="sm:space-x-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button size="sm" onClick={submit} disabled={!canSend || busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

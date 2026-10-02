import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Search } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { ContactAvatar } from "@/components/inbox/ContactAvatar";
import type { ConversationListItem } from "@/lib/inbox";

const MAX_TARGETS = 10;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  conversations: ConversationListItem[];
  /** Conversa de origem (fica de fora da lista). */
  currentId: string;
  preview: string;
  onForward: (conversationIds: string[]) => Promise<void>;
}

export function ForwardDialog({
  open,
  onOpenChange,
  conversations,
  currentId,
  preview,
  onForward,
}: Props) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setPicked([]);
  }, [open]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations
      .filter((c) => c.id !== currentId)
      .filter(
        (c) =>
          !q ||
          (c.contact_name ?? "").toLowerCase().includes(q) ||
          (c.contact_phone ?? "").includes(q.replace(/\D/g, "") || "\u0000"),
      );
  }, [conversations, currentId, query]);

  const toggle = (id: string) =>
    setPicked((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_TARGETS ? p : [...p, id],
    );

  const submit = async () => {
    setBusy(true);
    try {
      await onForward(picked);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-md">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>Encaminhar mensagem</DialogTitle>
          <DialogDescription>Escolha até {MAX_TARGETS} conversas.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 border-b border-border px-6 py-3">
          <div className="truncate rounded-lg border-l-4 border-primary bg-gray-100 px-3 py-2 text-xs text-gray-600 dark:bg-slate-800/60 dark:text-slate-300">
            {preview}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar conversa"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        <ul className="custom-scrollbar min-h-0 flex-1 overflow-y-auto py-1">
          {list.length === 0 && (
            <li className="px-6 py-8 text-center text-sm text-muted-foreground">
              Nenhuma conversa encontrada.
            </li>
          )}
          {list.map((c) => {
            const on = picked.includes(c.id);
            const name = c.contact_name || c.contact_phone || "Sem nome";
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => toggle(c.id)}
                  className="flex w-full items-center gap-3 px-6 py-2.5 text-left transition-colors hover:bg-gray-100 dark:hover:bg-slate-800/60"
                >
                  <ContactAvatar src={c.contact_avatar} name={name} className="h-10 w-10" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-gray-900 dark:text-slate-100">
                      {name}
                    </div>
                    {c.contact_phone && (
                      <div className="truncate text-xs text-muted-foreground">
                        {c.contact_phone}
                      </div>
                    )}
                  </div>
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                      on
                        ? "border-primary bg-primary text-white"
                        : "border-gray-300 dark:border-slate-600",
                    )}
                  >
                    {on && <Check className="h-3 w-3" />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <DialogFooter className="border-t border-border px-6 py-3 sm:space-x-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={picked.length === 0 || busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Encaminhar{picked.length > 0 && ` (${picked.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

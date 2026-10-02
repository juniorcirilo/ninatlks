import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ListChecks, Loader2, MessageCircle, Mic, Paperclip, Search, Send, X } from "lucide-react";
import { useAccount } from "@/lib/account-context";
import { subscribePresence, subscribeTable } from "@/lib/realtime-client";
import { MessageBubble } from "@/components/inbox/MessageBubble";
import { InteractiveDialog } from "@/components/inbox/InteractiveDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  fetchConversationMessages,
  fetchConversations,
  markConversationRead,
  sendConversationInteractive,
  sendConversationMedia,
  sendConversationMessage,
  sendConversationPresence,
  setConversationAutopilot,
  type ConversationListItem,
  type InteractiveInput,
} from "@/lib/inbox";

export const Route = createFileRoute("/_authenticated/inbox")({
  head: () => ({
    meta: [
      { title: "Mensagens — Nina Talks" },
      {
        name: "description",
        content:
          "Converse por WhatsApp com seus contatos, com a IA respondendo ou você no controle.",
      },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    contactId: typeof search.contactId === "string" ? search.contactId : undefined,
  }),
  component: InboxPage,
});

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "agora";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function InboxPage() {
  const { accountId } = useAccount();
  const { contactId } = Route.useSearch();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const listKey = useMemo(() => ["conversations", accountId] as const, [accountId]);
  const { data: conversations = [], isLoading } = useQuery({
    queryKey: listKey,
    queryFn: () => fetchConversations(accountId!),
    enabled: !!accountId,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!accountId) return;
    const unsubMessages = subscribeTable("messages", (e) => {
      if (e.accountId !== accountId) return;
      queryClient.invalidateQueries({ queryKey: listKey });
      if (e.conversationId) {
        queryClient.invalidateQueries({ queryKey: ["conversation-messages", e.conversationId] });
      }
    });
    const unsubConversations = subscribeTable("conversations", (e) => {
      if (e.accountId !== accountId) return;
      queryClient.invalidateQueries({ queryKey: listKey });
    });
    return () => {
      unsubMessages();
      unsubConversations();
    };
  }, [accountId, queryClient, listKey]);

  // Deep link from Central de Contatos (?contactId=...): abre/seleciona a
  // conversa desse contato assim que a lista carregar.
  useEffect(() => {
    if (!contactId || conversations.length === 0) return;
    const match = conversations.find((c) => c.contact_id === contactId);
    if (match) setSelectedId(match.id);
  }, [contactId, conversations]);

  useEffect(() => {
    if (!selectedId && conversations.length > 0 && !contactId) {
      setSelectedId(conversations[0].id);
    }
  }, [conversations, selectedId, contactId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        (c.contact_name ?? "").toLowerCase().includes(q) ||
        (c.contact_phone ?? "").includes(q.replace(/\D/g, "") || "\u0000"),
    );
  }, [conversations, query]);

  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden">
      <aside className="flex h-full min-h-0 w-[340px] shrink-0 flex-col border-r border-border bg-background">
        <div className="shrink-0 space-y-2 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Mensagens</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">WhatsApp via Evolution</p>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar contato ou número"
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              {conversations.length === 0
                ? "Nenhuma conversa de WhatsApp ainda."
                : "Nada encontrado."}
            </div>
          ) : (
            <ul className="space-y-1 px-2 py-2">
              {filtered.map((c) => (
                <ConversationListItemRow
                  key={c.id}
                  conversation={c}
                  active={c.id === selectedId}
                  onClick={() => setSelectedId(c.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </aside>

      <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-muted/20">
        {!selected ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <MessageCircle className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Selecione uma conversa para começar.</p>
          </div>
        ) : (
          <ConversationThread key={selected.id} conversation={selected} />
        )}
      </section>
    </div>
  );
}

function ConversationListItemRow({
  conversation,
  active,
  onClick,
}: {
  conversation: ConversationListItem;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={cn(
          "flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition",
          active ? "bg-primary/10" : "hover:bg-muted",
        )}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <MessageCircle className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12px] font-medium">
              {conversation.contact_name || conversation.contact_phone || "Sem nome"}
            </span>
            {conversation.unread && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="truncate">{conversation.last_message_content || "—"}</span>
            <span className="shrink-0">· {timeAgo(conversation.last_message_at)}</span>
          </div>
        </div>
      </button>
    </li>
  );
}

const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
// Compara pelos 8 últimos dígitos: tolera o 9º dígito e o DDI.
const samePhone = (a: string, b: string) =>
  a.length >= 8 && b.length >= 8 && a.slice(-8) === b.slice(-8);

const MAX_FILE_MB = 25;

function ConversationThread({ conversation }: { conversation: ConversationListItem }) {
  const { accountId } = useAccount();
  const queryClient = useQueryClient();
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [interactiveOpen, setInteractiveOpen] = useState(false);
  const [contactPresence, setContactPresence] = useState<string | null>(null);

  const messagesKey = useMemo(
    () => ["conversation-messages", conversation.id] as const,
    [conversation.id],
  );
  const { data: messages = [], isLoading } = useQuery({
    queryKey: messagesKey,
    queryFn: () => fetchConversationMessages(accountId!, conversation.id),
    enabled: !!accountId,
    staleTime: 5_000,
  });

  useEffect(() => {
    if (!accountId) return;
    markConversationRead(accountId, conversation.id).catch(() => {});
  }, [accountId, conversation.id, messages.length]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, contactPresence]);

  // Presença do contato ("digitando…" / "gravando áudio…").
  useEffect(() => {
    const phone = digits(conversation.contact_phone);
    let timer: number | undefined;
    const off = subscribePresence((e) => {
      if (!samePhone(digits(e.jid), phone)) return;
      window.clearTimeout(timer);
      if (e.presence === "composing" || e.presence === "recording") {
        setContactPresence(e.presence);
        timer = window.setTimeout(() => setContactPresence(null), 7000);
      } else {
        setContactPresence(null);
      }
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [conversation.contact_phone]);

  // Nossa presença: avisa "digitando" (no máx. 1x/4s) e "pausou" ao parar.
  const lastTyping = useRef(0);
  const pauseTimer = useRef<number | undefined>(undefined);
  const announce = (presence: "composing" | "paused") => {
    if (!accountId) return;
    sendConversationPresence(accountId, conversation.id, presence).catch(() => {});
  };
  const onDraftChange = (value: string) => {
    setDraft(value);
    window.clearTimeout(pauseTimer.current);
    if (!value.trim()) return announce("paused");
    if (Date.now() - lastTyping.current > 4000) {
      lastTyping.current = Date.now();
      announce("composing");
    }
    pauseTimer.current = window.setTimeout(() => {
      lastTyping.current = 0;
      announce("paused");
    }, 3000);
  };
  useEffect(() => () => window.clearTimeout(pauseTimer.current), []);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: messagesKey });
    queryClient.invalidateQueries({ queryKey: ["conversations", accountId] });
  };

  const handleSend = async () => {
    const content = draft.trim();
    if ((!content && !file) || !accountId) return;
    setSending(true);
    window.clearTimeout(pauseTimer.current);
    try {
      if (file) await sendConversationMedia(accountId, conversation.id, file, content);
      else await sendConversationMessage(accountId, conversation.id, content);
      setDraft("");
      setFile(null);
      lastTyping.current = 0;
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao enviar mensagem");
    } finally {
      setSending(false);
    }
  };

  const handleInteractive = async (input: InteractiveInput) => {
    if (!accountId) return;
    try {
      await sendConversationInteractive(accountId, conversation.id, input);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao enviar mensagem interativa");
      throw err;
    }
  };

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      toast.error(`Arquivo maior que ${MAX_FILE_MB} MB.`);
      return;
    }
    setFile(f);
  };

  const handleAutopilotToggle = async (enabled: boolean) => {
    if (!accountId) return;
    try {
      await setConversationAutopilot(accountId, conversation.id, enabled);
      queryClient.invalidateQueries({ queryKey: ["conversations", accountId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao atualizar conversa");
    }
  };

  const title = conversation.contact_name || conversation.contact_phone || "Sem nome";

  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{title}</h3>
          <p className="truncate text-[11px] text-muted-foreground">
            {contactPresence === "composing" ? (
              <span className="text-emerald-500">digitando…</span>
            ) : contactPresence === "recording" ? (
              <span className="text-emerald-500">gravando áudio…</span>
            ) : (
              conversation.contact_phone
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
          <span>{conversation.ai_autopilot_enabled ? "IA" : "Humano"}</span>
          <Switch
            checked={conversation.ai_autopilot_enabled}
            onCheckedChange={handleAutopilotToggle}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="space-y-2">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center text-center">
              <MessageCircle className="mb-3 h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Nenhuma mensagem ainda.</p>
            </div>
          ) : (
            messages.map((m) => <MessageBubble key={m.id} message={m} />)
          )}
          {contactPresence && (
            <div className="flex justify-start">
              <div className="flex items-center gap-1 rounded-lg border border-border bg-background px-3 py-2 text-muted-foreground">
                {contactPresence === "recording" ? (
                  <Mic className="h-3.5 w-3.5" />
                ) : (
                  [0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-current"
                      style={{ animationDelay: `${i * 150}ms` }}
                    />
                  ))
                )}
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <footer className="shrink-0 border-t border-border bg-background px-4 py-3">
        {file && (
          <div className="mb-2 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs">
            <Paperclip className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{file.name}</span>
            <span className="shrink-0 text-muted-foreground">
              {(file.size / 1024 / 1024).toFixed(1)} MB
            </span>
            <button
              type="button"
              onClick={() => setFile(null)}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            hidden
            onChange={(e) => {
              pickFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            title="Anexar arquivo"
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Mensagem interativa"
            onClick={() => setInteractiveOpen(true)}
          >
            <ListChecks className="h-4 w-4" />
          </Button>
          <Textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            onPaste={(e) => {
              const f = Array.from(e.clipboardData.files)[0];
              if (f) {
                e.preventDefault();
                pickFile(f);
              }
            }}
            placeholder={file ? "Legenda (opcional)…" : "Escreva uma mensagem…"}
            rows={2}
            className="min-h-0 resize-none"
          />
          <Button size="icon" onClick={handleSend} disabled={sending || (!draft.trim() && !file)}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </footer>

      <InteractiveDialog
        open={interactiveOpen}
        onOpenChange={setInteractiveOpen}
        onSend={handleInteractive}
      />
    </>
  );
}

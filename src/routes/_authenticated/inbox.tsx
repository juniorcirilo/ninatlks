import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileText,
  ListChecks,
  Loader2,
  MessageCircle,
  Mic,
  Paperclip,
  Reply,
  Search,
  Send,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useAccount } from "@/lib/account-context";
import { subscribePresence, subscribeTable } from "@/lib/realtime-client";
import { MessageBubble } from "@/components/inbox/MessageBubble";
import { ContactAvatar } from "@/components/inbox/ContactAvatar";
import { ForwardDialog } from "@/components/inbox/ForwardDialog";
import { InteractiveDialog } from "@/components/inbox/InteractiveDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  fetchConversationMessages,
  fetchDirectoryContacts,
  fetchDirectoryGroups,
  forwardMessage,
  resendMessage,
  startConversationByJid,
  type ConversationMessage,
  type DirectoryContact,
  type DirectoryGroup,
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
  const [tab, setTab] = useState<"chats" | "groups" | "contacts">("chats");
  const [opening, setOpening] = useState<string | null>(null);

  const listKey = useMemo(() => ["conversations", accountId] as const, [accountId]);
  const { data: conversations = [], isLoading } = useQuery({
    queryKey: listKey,
    queryFn: () => fetchConversations(accountId!),
    enabled: !!accountId,
    staleTime: 10_000,
  });

  const { data: dirContacts = [], isLoading: loadingContacts } = useQuery({
    queryKey: ["directory-contacts", accountId],
    queryFn: () => fetchDirectoryContacts(accountId!),
    enabled: !!accountId && tab === "contacts",
    staleTime: 60_000,
  });
  const { data: dirGroups = [], isLoading: loadingGroups } = useQuery({
    queryKey: ["directory-groups", accountId],
    queryFn: () => fetchDirectoryGroups(accountId!),
    enabled: !!accountId && tab === "groups",
    staleTime: 60_000,
  });

  const openContact = async (c: DirectoryContact) => {
    if (!accountId) return;
    setOpening(c.jid);
    try {
      const res = await startConversationByJid(accountId, {
        jid: c.jid,
        name: c.name,
        picture: c.picture,
      });
      await queryClient.invalidateQueries({ queryKey: listKey });
      setSelectedId(res.id);
      setTab("chats");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível abrir a conversa");
    } finally {
      setOpening(null);
    }
  };

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
      <aside className="flex h-full min-h-0 w-[388px] shrink-0 flex-col border-r border-gray-200 bg-white dark:border-slate-800 dark:bg-[#111b21]">
        <div className="shrink-0 space-y-2 bg-gray-100/80 px-4 py-3 dark:bg-[#202c33]">
          <div>
            <h2 className="text-base font-semibold text-gray-800 dark:text-[#e9edef]">Mensagens</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">WhatsApp via Evolution</p>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === "groups" ? "Buscar grupo" : "Buscar contato ou número"}
              className="h-9 rounded-lg border-none bg-white pl-8 text-sm dark:bg-[#111b21]"
            />
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-white p-1 dark:bg-[#111b21]">
            {(
              [
                ["chats", "Conversas", MessageCircle, conversations.length],
                ["groups", "Grupos", Users, tab === "groups" ? dirGroups.length : null],
                ["contacts", "Contatos", UserRound, tab === "contacts" ? dirContacts.length : null],
              ] as const
            ).map(([k, label, Icon, count]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors",
                  tab === k
                    ? "bg-primary text-white"
                    : "text-gray-600 hover:bg-gray-100 dark:text-[#aebac1] dark:hover:bg-[#202c33]",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
                {count !== null && count > 0 && <span className="opacity-70">{count}</span>}
              </button>
            ))}
          </div>
        </div>

        {tab === "groups" && <GroupList groups={dirGroups} loading={loadingGroups} query={query} />}
        {tab === "contacts" && (
          <ContactList
            contacts={dirContacts}
            loading={loadingContacts}
            query={query}
            opening={opening}
            onOpen={openContact}
          />
        )}

        <div className={cn("min-h-0 flex-1 overflow-y-auto", tab !== "chats" && "hidden")}>
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

      <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-gray-50 dark:bg-[#0B0E14]">
        {!selected ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <MessageCircle className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Selecione uma conversa para começar.</p>
          </div>
        ) : (
          <ConversationThread
            key={selected.id}
            conversation={selected}
            allConversations={conversations}
          />
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
          "flex w-full items-center gap-3 px-3 py-3 text-left transition-colors duration-150",
          active ? "bg-gray-100 dark:bg-[#2a3942]" : "hover:bg-gray-50 dark:hover:bg-[#182229]",
        )}
      >
        <ContactAvatar
          src={conversation.contact_avatar}
          name={conversation.contact_name || conversation.contact_phone || "?"}
          className="h-12 w-12"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-gray-900 dark:text-[#e9edef]">
              {conversation.contact_name || conversation.contact_phone || "Sem nome"}
            </span>
            {conversation.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-gray-500 dark:text-[#8696a0]">
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

function ConversationThread({
  conversation,
  allConversations,
}: {
  conversation: ConversationListItem;
  allConversations: ConversationListItem[];
}) {
  const { accountId } = useAccount();
  const queryClient = useQueryClient();
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [interactiveOpen, setInteractiveOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [replyTo, setReplyTo] = useState<ConversationMessage | null>(null);
  const [forwardOf, setForwardOf] = useState<ConversationMessage | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
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

  // Cresce com o texto (até max-h) e volta ao tamanho mínimo ao limpar.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

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
      const res = file
        ? await sendConversationMedia(accountId, conversation.id, file, content, replyTo?.id)
        : await sendConversationMessage(accountId, conversation.id, content, replyTo?.id);
      // ok:false = a mensagem ficou registrada com erro (balão vermelho).
      if (!res.ok) toast.error(`Não foi possível enviar: ${res.error}`);
      setDraft("");
      setFile(null);
      setReplyTo(null);
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
      const res = await sendConversationInteractive(accountId, conversation.id, input, replyTo?.id);
      if (!res.ok) toast.error(`Não foi possível enviar: ${res.error}`);
      setReplyTo(null);
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

  const handleResend = async (m: ConversationMessage) => {
    if (!accountId) return;
    try {
      const res = await resendMessage(accountId, m.id);
      if (res.ok) toast.success("Mensagem reenviada.");
      else toast.error(`Falhou novamente: ${res.error}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível reenviar");
    } finally {
      refresh();
    }
  };

  const handleForward = async (conversationIds: string[]) => {
    if (!accountId || !forwardOf) return;
    try {
      const res = await forwardMessage(accountId, forwardOf.id, conversationIds);
      const failed = res.results.filter((r) => !r.ok).length;
      if (failed) toast.error(`${failed} de ${res.results.length} encaminhamentos falharam.`);
      else toast.success(`Mensagem encaminhada para ${res.results.length} conversa(s).`);
      queryClient.invalidateQueries({ queryKey: ["conversations", accountId] });
      for (const id of conversationIds)
        queryClient.invalidateQueries({ queryKey: ["conversation-messages", id] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao encaminhar");
      throw err;
    }
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
      <div className="z-10 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-gray-100 px-6 dark:border-slate-800 dark:bg-slate-900/80 dark:backdrop-blur-md">
        <ContactAvatar src={conversation.contact_avatar} name={title} className="h-10 w-10" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-bold text-gray-800 dark:text-slate-100">{title}</h3>
          <p className="truncate text-[11px] text-muted-foreground">
            {contactPresence === "composing" ? (
              <span className="animate-pulse font-medium text-orange-400">digitando…</span>
            ) : contactPresence === "recording" ? (
              <span className="animate-pulse font-medium text-orange-400">gravando áudio…</span>
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

      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-6">
        <div className="space-y-4">
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
            messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onReply={(msg) => {
                  setReplyTo(msg);
                  textRef.current?.focus();
                }}
                onForward={setForwardOf}
                onResend={handleResend}
              />
            ))
          )}
          {contactPresence && (
            <div className="flex justify-start">
              <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-gray-200 px-3 py-2 text-gray-500 shadow-sm dark:bg-slate-700/80 dark:text-slate-400">
                {contactPresence === "recording" ? (
                  <Mic className="h-3.5 w-3.5" style={{ animation: "mic-pulse 1s infinite" }} />
                ) : (
                  [0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 rounded-full bg-current"
                      style={{
                        animation: "presenceBounce 1.2s infinite",
                        animationDelay: `${i * 150}ms`,
                      }}
                    />
                  ))
                )}
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <footer className="z-10 shrink-0 border-t border-gray-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900/90 dark:backdrop-blur-sm">
        <input
          ref={fileRef}
          type="file"
          hidden
          onChange={(e) => {
            pickFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pickFile(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            "mx-auto flex max-w-4xl flex-col rounded-2xl border bg-gray-50 shadow-sm transition-all dark:bg-slate-950",
            dragging
              ? "border-2 border-primary ring-2 ring-primary/20"
              : "border-gray-300 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 dark:border-slate-800",
          )}
        >
          {replyTo && (
            <div className="m-2 mb-0 flex items-center gap-3 rounded-xl border-l-4 border-primary bg-gray-100 p-2 pl-3 dark:bg-slate-900">
              <Reply className="h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-primary dark:text-cyan-300">
                  Respondendo {replyTo.sender_type === "Contact" ? title : "a você"}
                </div>
                <div className="truncate text-xs text-gray-600 dark:text-slate-400">
                  {replyTo.content || "Mensagem"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                aria-label="Cancelar resposta"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {file && <FileChip file={file} onRemove={() => setFile(null)} />}

          <textarea
            ref={textRef}
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
            placeholder={
              dragging
                ? "Solte o arquivo para anexar…"
                : file
                  ? "Adicione uma legenda (opcional)…"
                  : "Escreva uma mensagem…"
            }
            rows={1}
            className="max-h-48 min-h-[48px] w-full resize-none border-0 bg-transparent px-4 pb-1 pt-3.5 text-sm leading-relaxed text-gray-700 outline-none placeholder:text-gray-400 no-focus-ring dark:text-slate-200 dark:placeholder:text-slate-600"
          />

          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <div className="flex items-center gap-0.5">
              <ComposerAction label="Anexar arquivo" onClick={() => fileRef.current?.click()}>
                <Paperclip className="h-[18px] w-[18px]" />
              </ComposerAction>
              <ComposerAction label="Mensagem interativa" onClick={() => setInteractiveOpen(true)}>
                <ListChecks className="h-[18px] w-[18px]" />
              </ComposerAction>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden text-[11px] text-gray-400 dark:text-slate-600 sm:inline">
                Enter envia · Shift+Enter quebra linha
              </span>
              <button
                type="button"
                onClick={handleSend}
                disabled={sending || (!draft.trim() && !file)}
                aria-label="Enviar"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-emerald-400 text-white shadow-xl ring-1 ring-white/10 transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:bg-none disabled:bg-gray-200 disabled:text-gray-400 disabled:opacity-60 disabled:hover:scale-100 dark:disabled:bg-slate-800 dark:disabled:text-slate-600"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </footer>

      <ForwardDialog
        open={!!forwardOf}
        onOpenChange={(v) => !v && setForwardOf(null)}
        conversations={allConversations}
        currentId={conversation.id}
        preview={forwardOf?.content || "Mensagem"}
        onForward={handleForward}
      />

      <InteractiveDialog
        open={interactiveOpen}
        onOpenChange={setInteractiveOpen}
        onSend={handleInteractive}
      />
    </>
  );
}

function ComposerAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-200/70 hover:text-gray-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
    >
      {children}
    </button>
  );
}

function FileChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const isImage = file.type.startsWith("image/");
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!isImage) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);

  return (
    <div className="m-2 mb-0 flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
      {preview ? (
        <img src={preview} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <FileText className="h-5 w-5" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-gray-800 dark:text-slate-100">
          {file.name}
        </div>
        <div className="text-[11px] text-gray-500 dark:text-slate-400">
          {(file.size / 1024 / 1024).toFixed(file.size > 1024 * 1024 ? 1 : 2)} MB
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remover anexo"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function matchesQuery(q: string, ...fields: (string | null | undefined)[]) {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  const digits = t.replace(/\D/g, "");
  return fields.some(
    (f) =>
      !!f &&
      (f.toLowerCase().includes(t) || (digits.length > 2 && f.replace(/\D/g, "").includes(digits))),
  );
}

function ListState({ loading, empty }: { loading: boolean; empty: string }) {
  return (
    <div className="flex h-40 items-center justify-center px-4 text-center text-xs text-muted-foreground">
      {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : empty}
    </div>
  );
}

function ContactList({
  contacts,
  loading,
  query,
  opening,
  onOpen,
}: {
  contacts: DirectoryContact[];
  loading: boolean;
  query: string;
  opening: string | null;
  onOpen: (c: DirectoryContact) => void;
}) {
  const list = contacts.filter((c) => matchesQuery(query, c.name, c.phone));
  return (
    <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
      {list.length === 0 ? (
        <ListState
          loading={loading}
          empty={contacts.length ? "Nada encontrado." : "Nenhum contato no WhatsApp."}
        />
      ) : (
        <ul>
          {list.map((c) => {
            const label = c.name || (c.phone ? `+${c.phone}` : "Contato sem número");
            return (
              <li key={c.jid}>
                <button
                  type="button"
                  onClick={() => onOpen(c)}
                  disabled={opening === c.jid}
                  className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-gray-50 disabled:opacity-60 dark:hover:bg-[#182229]"
                >
                  <ContactAvatar src={c.picture} name={label} className="h-12 w-12" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-gray-900 dark:text-[#e9edef]">
                      {label}
                    </div>
                    <div className="truncate text-[13px] text-gray-500 dark:text-[#8696a0]">
                      {c.phone ? `+${c.phone}` : "Número oculto (LID)"}
                    </div>
                  </div>
                  {opening === c.jid && (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function GroupList({
  groups,
  loading,
  query,
}: {
  groups: DirectoryGroup[];
  loading: boolean;
  query: string;
}) {
  const list = groups.filter((g) => matchesQuery(query, g.name));
  return (
    <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
      {list.length === 0 ? (
        <ListState
          loading={loading}
          empty={groups.length ? "Nada encontrado." : "Nenhum grupo no WhatsApp."}
        />
      ) : (
        <ul>
          {list.map((g) => (
            <li key={g.jid} className="flex items-center gap-3 px-3 py-3">
              <ContactAvatar src={g.picture} name={g.name} className="h-12 w-12" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-gray-900 dark:text-[#e9edef]">
                  {g.name}
                </div>
                <div className="truncate text-[13px] text-gray-500 dark:text-[#8696a0]">
                  {g.size} participante{g.size === 1 ? "" : "s"}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Loader2,
  MessageCircle,
  Send,
  User as UserIcon,
} from "lucide-react";
import { useAccount } from "@/lib/account-context";
import { subscribeTable } from "@/lib/realtime-client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  fetchConversationMessages,
  fetchConversations,
  markConversationRead,
  sendConversationMessage,
  setConversationAutopilot,
  type ConversationListItem,
  type ConversationMessage,
} from "@/lib/inbox";

export const Route = createFileRoute("/_authenticated/inbox")({
  head: () => ({
    meta: [
      { title: "Mensagens — Nina Talks" },
      {
        name: "description",
        content: "Converse por WhatsApp com seus contatos, com a IA respondendo ou você no controle.",
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

  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-0 w-full">
      <aside className="flex h-full w-[340px] shrink-0 flex-col border-r border-border bg-background">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Mensagens</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">WhatsApp via Evolution</p>
        </div>

        <ScrollArea className="flex-1">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              Nenhuma conversa de WhatsApp ainda.
            </div>
          ) : (
            <ul className="space-y-1 px-2 py-2">
              {conversations.map((c) => (
                <ConversationListItemRow
                  key={c.id}
                  conversation={c}
                  active={c.id === selectedId}
                  onClick={() => setSelectedId(c.id)}
                />
              ))}
            </ul>
          )}
        </ScrollArea>
      </aside>

      <section className="flex h-full min-w-0 flex-1 flex-col bg-muted/20">
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

function ConversationThread({ conversation }: { conversation: ConversationListItem }) {
  const { accountId } = useAccount();
  const queryClient = useQueryClient();
  const endRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

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
  }, [accountId, conversation.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || !accountId) return;
    setSending(true);
    try {
      await sendConversationMessage(accountId, conversation.id, content);
      setDraft("");
      queryClient.invalidateQueries({ queryKey: messagesKey });
      queryClient.invalidateQueries({ queryKey: ["conversations", accountId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao enviar mensagem");
    } finally {
      setSending(false);
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

  return (
    <>
      <div className="flex items-center justify-between border-b border-border bg-background px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">
            {conversation.contact_name || conversation.contact_phone || "Sem nome"}
          </h3>
          <p className="text-[11px] text-muted-foreground">{conversation.contact_phone}</p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{conversation.ai_autopilot_enabled ? "IA" : "Humano"}</span>
          <Switch
            checked={conversation.ai_autopilot_enabled}
            onCheckedChange={handleAutopilotToggle}
          />
        </div>
      </div>

      <ScrollArea className="flex-1 px-4 py-3">
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
          <div ref={endRef} />
        </div>
      </ScrollArea>

      <footer className="border-t border-border bg-background px-4 py-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Escreva uma mensagem…"
            rows={2}
            className="min-h-0 resize-none"
          />
          <Button size="icon" onClick={handleSend} disabled={sending || !draft.trim()}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </footer>
    </>
  );
}

function MessageBubble({ message }: { message: ConversationMessage }) {
  const isOutbound = message.sender_type === "User" || message.sender_type === "AgentBot";
  const isBot = message.sender_type === "AgentBot";
  return (
    <div className={cn("flex", isOutbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[75%] rounded-lg border px-3 py-2 text-sm",
          isOutbound
            ? "border-violet-500/15 bg-violet-500/[0.06]"
            : "border-border bg-background",
        )}
      >
        {isOutbound && (
          <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {isBot ? (
              <>
                <Bot className="h-3 w-3 text-violet-500" />
                <span className="text-violet-600 dark:text-violet-300">Nina</span>
              </>
            ) : (
              <>
                <UserIcon className="h-3 w-3 text-sky-500" />
                <span className="text-sky-600 dark:text-sky-300">Você</span>
              </>
            )}
          </div>
        )}
        <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
        <div className="mt-1 text-right text-[10px] opacity-60">
          {new Date(message.created_at).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>
    </div>
  );
}
